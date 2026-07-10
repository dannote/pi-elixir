defmodule Pi.MCP.Router do
  @moduledoc "Plug router for embedded pi-elixir."

  use Plug.Router

  alias Pi.Bridge.Info
  alias Pi.MCP.JSONRPC
  alias Pi.Project.Context

  plug(:match)
  plug(Plug.Parsers, parsers: [:json], json_decoder: Jason)
  plug(:dispatch)

  get "/config" do
    context = Context.current()

    body =
      Jason.encode!(%{
        project_name: Info.snapshot(:http).project |> Atom.to_string(),
        project_root: context.root,
        framework_type: "embedded"
      })

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, body)
  end

  post "/mcp" do
    case JSONRPC.handle(conn.body_params) do
      {:ok, body} ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(200, Jason.encode!(JSONRPC.to_map(body)))

      {:error, body} ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(400, Jason.encode!(JSONRPC.to_map(body)))
    end
  end

  match _ do
    send_resp(conn, 404, "Not Found")
  end
end
