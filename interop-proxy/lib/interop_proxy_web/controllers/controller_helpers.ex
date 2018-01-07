defmodule InteropProxyWeb.ControllerHelpers do
  @doc """
  Send a message either in an encoded Protobuf or JSON if requested.

  This will check the Accepts header, if it's set to JSON it'll send
  it as JSON for easier testing and implementation when needed.
  """
  def send_message(conn, status_code \\ 200, message) do
    {content_type, binary} = case Plug.Conn.get_req_header conn, "accept" do
      ["application/json"] ->
        {"application/json", Poison.encode!(message)}
      _ ->
        {"application/x-protobuf", message |> message.__struct__.encode}
    end

    conn
    |> Plug.Conn.put_resp_content_type(content_type)
    |> Plug.Conn.send_resp(status_code, binary)
  end

  @doc """
  Checking if a param string means to be `true`.
  
  If no parameter is passed, this returns false.

  This will return `true` for things like `"true"`, `"True"`, or "1".
  """
  def is_truthy(string \\ <<>>)

  def is_truthy("1"), do: true
  def is_truthy(string) when is_binary(string),
    do: String.downcase(string) === "true"
  def is_truthy(t), do: t === true
end
