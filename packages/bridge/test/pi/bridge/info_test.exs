defmodule Pi.Bridge.InfoTest do
  use ExUnit.Case, async: false

  alias Pi.Bridge.Info
  alias Pi.Protocol.BridgeInfo
  alias Pi.Protocol.Ready
  alias Pi.Transport.Stdio

  test "snapshot returns a strict protocol struct" do
    version = Application.spec(:pi_bridge, :vsn) |> to_string()

    assert %BridgeInfo{
             project: :pi_bridge,
             version: ^version,
             build: "pi_bridge@" <> _,
             protocol: 2,
             transport: :stdio,
             capabilities: capabilities
           } = Info.snapshot(:stdio)

    assert :project_eval_worker in capabilities
    assert :attached_runtime_eval in capabilities
  end

  test "ready event encodes bridge info at the transport boundary" do
    version = Application.spec(:pi_bridge, :vsn) |> to_string()
    ready = %Ready{type: :ready, info: Info.snapshot(:stdio)}
    encoded = Jason.encode!(Stdio.__test_payload__(ready))

    assert %{
             "type" => "ready",
             "info" => %{
               "project" => "pi_bridge",
               "version" => ^version,
               "protocol" => 2,
               "capabilities" => capabilities
             }
           } = Jason.decode!(encoded)

    assert "structured_diagnostics" in capabilities
  end

  test "snapshot reads isolated target project app name from mix.exs AST" do
    previous = System.get_env("PI_ELIXIR_PROJECT_CWD")
    dir = Path.join(System.tmp_dir!(), "pi-elixir-info-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)

    File.write!(Path.join(dir, "mix.exs"), """
    defmodule Demo.MixProject do
      use Mix.Project

      def project do
        [
          app: :isolated_demo,
          version: "0.1.0",
          deps: []
        ]
      end
    end
    """)

    System.put_env("PI_ELIXIR_PROJECT_CWD", dir)

    try do
      assert %BridgeInfo{project: :isolated_demo} = Info.snapshot(:stdio)
    after
      if previous,
        do: System.put_env("PI_ELIXIR_PROJECT_CWD", previous),
        else: System.delete_env("PI_ELIXIR_PROJECT_CWD")

      File.rm_rf!(dir)
    end
  end

  test "runtime inventory and eval prelude expose host helpers separately from sessions" do
    runtime_modules = Enum.map(Info.runtime_apis(), & &1.module)

    assert Pi.Host in runtime_modules
    assert Pi.Session in runtime_modules
    assert Info.aliases_code() =~ "alias Pi.Host, as: Host"
  end
end
