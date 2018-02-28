import logging
import os
import sys
from threading import Thread
import time

import dronekit
from flask import Flask, jsonify, request

from messages import interop_pb2, telemetry_pb2
import util


cxn_str = os.environ['CXN_STR']
baud_rate = int(os.environ['BAUD_RATE'])
timeout = int(os.environ['CXN_TIMEOUT'])
retry_cxn = os.environ['RETRY_CXN'].lower() in ['1', 'true']

# We'll connect to the plane before we serve the endpoints
print('\x1b[33mConnecting to ' + cxn_str + '...\x1b[0m')

vehicle=None

# Limiting the amount of time dronekit can load to the timeout
# provided.
while vehicle is None:
    wait_for = ['gps_0', 'armed', 'mode', 'attitude']

    try:
        with util.time_limit(timeout):
            vehicle = dronekit.connect(cxn_str, baud=baud_rate,
                                                heartbeat_timeout=False,
                                                wait_ready=wait_for)
    except util.TimeoutException as e:
        if retry_cxn:
            print('\x1b[31mConnection timed out after ' + str(timeout) +
                    ' seconds... trying again.\x1b[0m')
        else:
            print('\x1b[31mConnection timed out after ' + str(timeout) +
                    ' seconds.\1b[0m')
            sys.exit(1)

print('\x1b[32mConnection successful.\x1b[0m')

print('Getting initial mission...')

last_commands = util.get_commands(vehicle)

print('\x1b[32mMission received.\x1b[0m')


# Starting a thread to retrieve commands every 5 seconds (at most).
def get_commands_thread():
    while True:
        time.sleep(5)

        try:
            global last_commands
            last_commands = util.get_commands(vehicle, timeout=15)
        except dronekit.APIException as e:
            print('Mission download timed out after 15 seconds.')


t = Thread(target=get_commands_thread)
t.start()

app = Flask(__name__)


@app.route('/api/interop-telem')
def get_interop_telem():
    """Get the lat, lon, alt_msl, yaw of the plane"""
    loc = vehicle.location.global_frame
    attitude = vehicle.attitude

    lat = loc.lat
    lon = loc.lon
    alt_msl = loc.alt
    yaw = attitude.yaw

    # This telemetry is only useful if it's all here
    if not util.all_exist(lat, lon, alt_msl, yaw):
        return '', 204

    msg = interop_pb2.InteropTelem(
        time=time.time(),
        pos=interop_pb2.AerialPosition(
            lat=lat,
            lon=lon,
            alt_msl=alt_msl,
        ),
        yaw=util.mod_deg(util.rad_to_deg(yaw))
    )

    return util.protobuf_resp(msg, request.headers.get('accept'))


@app.route('/api/camera-telem')
def get_camera_telem():
    """Get the lat, lon, alt, yaw, pitch, roll of the camera"""
    loc = vehicle.location.global_relative_frame
    attitude = vehicle.attitude
    gimbal = vehicle.gimbal

    # Getting values from the above. Note that we do not use the
    # gimbal yaw, since historically, we've never used a camera
    # gimbal that twists.
    lat = loc.lat
    lon = loc.lon
    alt = loc.alt
    yaw = attitude.yaw
    p_pitch = attitude.pitch
    p_roll = attitude.roll
    g_pitch = gimbal.pitch
    g_roll = gimbal.roll

    # This telemetry is only useful if we at least have the basic
    # plane telemetry
    if not util.all_exist(lat, lon, alt, yaw, p_pitch, p_roll):
        return '', 204    

    # Setting default gimbal position to be orthagonal to the plane
    if g_pitch is None or g_roll is None:
        g_pitch = -90
        g_roll = 0

        print('\x1b[33mCamera telemetry requested but no gimbal detected.'
                '\x1b[0m')

    msg = telemetry_pb2.CameraTelem(
        time=time.time(),
        lat=lat,
        lon=lon,
        alt=alt,
        yaw=util.mod_deg(util.rad_to_deg(yaw)),
        pitch=util.mod_deg_2(util.rad_to_deg(p_pitch) + g_pitch),
        roll=util.mod_deg_2(util.rad_to_deg(-p_roll) + g_roll)
    )

    return util.protobuf_resp(msg, request.headers.get('accept'))


@app.route('/api/raw-mission')
def get_raw_mission():
    """Get the mission in dronekit's cache directly."""
    return util.protobuf_resp(last_commands, request.headers.get('accept'))


@app.route('/api/alive')
def get_alive():
    """Sanity check to make sure the server is up"""
    return 'Yes, I\'m alive!\n', 200, {
        'content-type': 'text/plain; charset=utf-8'
    }


# Silence logging from sucessful requests
logging.getLogger('werkzeug').setLevel(logging.WARNING)