defmodule Pi.Project do
  @moduledoc "Project and isolated bridge-control metadata for eval sessions."

  alias Pi.Bridge.Info
  alias Pi.Project.Context

  def info do
    context = Context.current()
    control_config = Mix.Project.config()
    control_app = Keyword.fetch!(control_config, :app)

    %{
      app: Info.snapshot().project,
      root: context.root,
      mix_env: context.mix_env,
      elixir: System.version(),
      otp: System.otp_release(),
      control: %{
        app: control_app,
        root: File.cwd!(),
        mix_env: Mix.env(),
        deps: control_deps(),
        applications: applications(control_app)
      }
    }
  end

  defp control_deps do
    Mix.Project.deps_paths()
    |> Enum.map(fn {app, path} ->
      %{app: app, path: Path.relative_to_cwd(path), vsn: app_vsn(app)}
    end)
    |> Enum.sort_by(& &1.app)
  end

  defp applications(app) do
    Application.load(app)

    app
    |> Application.spec(:applications)
    |> List.wrap()
    |> Enum.sort()
  end

  defp app_vsn(app) do
    case Application.spec(app, :vsn) do
      nil -> nil
      vsn -> List.to_string(vsn)
    end
  end
end
