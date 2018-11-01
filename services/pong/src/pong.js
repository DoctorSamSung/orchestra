/**
 * This service tracks the ping of the other services.
 *
 * The input is simply passed as command-line arguments in a comma-
 * seperated form like so:
 *
 *     pong.js some-service,192.168.0.3 another-service,192.168.0.4
 *
 * This will keep track of the ping times by assuming a
 * GET /api/alive endpoint exists for each service, and it will see
 * how long the request takes, round-trip, every 3 seconds.
 *
 * To use a different endpoint to ping against, specify the endpoint
 * after the host.
 *
 *     pong.js interop-server,10.10.130.10:8080,/some/endpoint
 *
 * This is exposed by a rest api to make it accessible to the other
 * services.
 */

import async from 'async';
import express from 'express';
import request from 'request';

import { PingTimes } from './messages/stats_pb';

// Get the amount of time until a service is said to be offline in
// milliseconds.
let requestTimeout = parseInt(process.env.REQUEST_TIMEOUT) || 5000;

// Get the list of services to be pinged.
let input = process.argv.slice(2);

if (input.length === 0) {
    console.error('No input passed.');
    process.exit(1);
}

// Holding the ping values here.
let ping = {};

// Populating the ping values from the input.
for (let string of input) {
    let split = string.split(',');

    if (split.length !== 2 && split.length !== 3) {
        console.error('Expected input args to be in the form: ');
        console.error('    service-name,host:port');
        console.error('or alternatively:');
        console.error('    service-name,host:port,endpoint');
        process.exit(1);
    }

    let name = split[0];
    let host;
    let port = '80';
    let endpoint = '/api/alive';

    let urlSplit = split[1].split(':');

    host = urlSplit[0];

    if (urlSplit.length !== 1) {
        port = urlSplit[1];
    }

    if (split.length === 3) {
        endpoint = split[2];
    }

    // Each one just has a host, whether or not it is online, and the
    // millisecond ping time.
    ping[name] = {
        host: host,
        port: port,
        endpoint: endpoint,
        online: false,
        ms: 0.0
    };
}

// Making async workers to update the ping values for each service.
let workers = [];

for (let name in ping) {
    if (ping.hasOwnProperty(name)) {
        workers.push(startWorker(name));
    }
}

function startWorker(name) {
    // Storing the current worker timeout, if there is one at the
    // moment, in case the worker needs to be killed.
    let currTimeout = undefined;

    // Starting a task that repeats forever for each service. There's
    // a 3 second downtime after a request is made before it goes to
    // the next.
    async.forever((next) => {
        // Making the request, if it's not successful, the service is
        // offline, otherwise, it's online and we'll record the
        // amount of time passed.
        request.get({
            url: 'http://' + ping[name].host + ':' + ping[name].port +
                    ping[name].endpoint,
            followRedirect: false,
            time: true,
            timeout: 5000
        }, (err, res) => {
            if (err || res.statusCode >= 400) {
                ping[name].online = false;
                ping[name].ms = 0.0;
            } else {
                ping[name].online = true;
                ping[name].ms = res.elapsedTime;
            }

            // Repeat again in 3 seconds.
            currTimeout = setTimeout(next, 3000);
        });
    });

    // Return an object to that'll allow this worker to be killed if
    // needed.
    return { close: () => clearTimeout(currTimeout) };
}

// Making the api to get the ping times.
let app = express();

app.get('/api/ping', (req, res) => {
    let msg = new PingTimes();

    msg.setTime((new Date()).getTime() / 1000);

    let list = [];

    // Sorting the list by the name of the service and building the
    // list field.
    for (let name of Object.keys(ping).sort()) {
        let inner = new PingTimes.ServicePing();

        inner.setName(name);
        inner.setHost(ping[name].host);
        inner.setPort(ping[name].port);
        inner.setOnline(ping[name].online);
        inner.setMs(ping[name].ms);

        list.push(inner);
    }

    msg.setListList(list);

    // If the client wants JSON, we'll send them Protobuf-style JSON
    // instead, otherwise, send the Protobuf.
    let accept = req.get('accept');

    if (accept === undefined || !accept.startsWith('application/json')) {
        res.set('content-type', 'application/x-protobuf');
        res.send(Buffer.from(msg.serializeBinary()));
    } else {
        res.send(msg.toObject());
    }
});

// Sanity check, and can be used in case we're pinging this service
// with itself.
app.get('/api/alive', (req, res) => {
    res.set('content-type', 'text/plain');
    res.send('Yeah, this is kinda meta tho.\n');
});

let server = app.listen(7000);

console.log('Running server with Express at http://0.0.0.0:7000');

// Wrapping the close method so it clears the workers as well.
let defaultClose = server.close;

server.close = function () {
    workers.map(worker => worker.close());
    return defaultClose.apply(this, arguments);
}

export { app, server };