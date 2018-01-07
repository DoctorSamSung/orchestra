defmodule InteropProxy.Sanitize do
  @moduledoc """
  Translates the interop server responses to our own and vise-versa.
  """

  # Aliasing the main messages.
  alias InteropProxy.Message.Interop.{
    Position, AerialPosition, Mission, Obstacles, InteropTelem, InteropMessage
  }

  # Aliasing the nested messages.
  alias InteropProxy.Message.Interop.Mission.FlyZone
  alias InteropProxy.Message.Interop.Obstacles.{
    StationaryObstacle, MovingObstacle
  }

  def sanitize_mission(nil) do
    %Mission{
      time: time(),
      current_mission: false
    }
  end

  def sanitize_mission(mission) do
    %Mission{
      time: time(),
      current_mission: true,
      air_drop_pos: mission["air_drop_pos"] |> sanitize_position,
      fly_zones: mission["fly_zones"] |> sanitize_fly_zones,
      home_pos: mission["home_pos"] |> sanitize_position,
      waypoints: mission["mission_waypoints"] |> sanitize_aerial_position,
      off_axis_pos: mission["off_axis_odlc_pos"] |> sanitize_position,
      emergent_pos: mission["emergent_last_known_pos"] |> sanitize_position,
      search_area: mission["search_grid_points"] |> sanitize_aerial_position
    }
  end

  defp sanitize_fly_zones(fly_zones) do
    fly_zones
    |> Enum.map(fn fly_zone -> 
      %FlyZone{
        alt_msl_max: fly_zone["altitude_msl_max"] |> meters,
        alt_msl_min: fly_zone["altitude_msl_min"] |> meters,
        boundary: fly_zone["boundary_pts"] |> sanitize_position
      }
    end)
  end

  def sanitize_obstacles(obstacles) do
    %Obstacles{
      time: time(),
      stationary: obstacles["stationary_obstacles"]
                  |> sanitize_stationary_obstacles,    
      moving: obstacles["moving_obstacles"]
              |> sanitize_moving_obstacles
    }
  end

  defp sanitize_stationary_obstacles(stationary) do
    stationary
    |> Enum.map(fn obs ->
      %StationaryObstacle{
        pos: obs |> sanitize_position,
        height: obs["cylinder_height"] |> meters,
        radius: obs["cylinder_radius"] |> meters
      }
    end)
  end

  defp sanitize_moving_obstacles(moving) do
    moving
    |> Enum.map(fn obs ->
      %MovingObstacle{
        pos: obs |> sanitize_aerial_position,
        radius: obs["sphere_radius"] |> meters
      }
    end)
  end

  def sanitize_outgoing_telemetry(%InteropTelem{} = telem) do
    %{
      latitude: telem.pos.lat,
      longitude: telem.pos.lon,
      altitude_msl: telem.pos.alt_msl |> feet,
      uas_heading: telem.yaw
    }
  end

  def sanitize_message(text) do
    %InteropMessage{
      time: time(),
      text: text
    }
  end

  defp sort_order(list) do
    list
    |> Enum.sort(fn a, b -> a["order"] < b["order"] end)
  end

  defp sanitize_position(pos) when is_list(pos) do
    pos
    |> sort_order
    |> Enum.map(&sanitize_position/1)
  end

  defp sanitize_position(pos) do
    %Position{
      lat: pos["latitude"],
      lon: pos["longitude"]
    }
  end

  defp sanitize_aerial_position(pos) when is_list(pos) do
    pos
    |> sort_order
    |> Enum.map(&sanitize_aerial_position/1)
  end

  defp sanitize_aerial_position(pos) do
    %AerialPosition{
      lat: pos["latitude"],
      lon: pos["longitude"],
      alt_msl: pos["altitude_msl"] |> meters
    }
  end

  defp meters(feet), do: feet * 0.3048

  defp feet(meters), do: meters / 0.3048

  defp time() do
    milliseconds = DateTime.utc_now()
    |> DateTime.to_unix(:millisecond)

    milliseconds / 1000
  end
end
