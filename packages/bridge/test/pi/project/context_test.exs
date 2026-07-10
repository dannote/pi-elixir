defmodule Pi.Project.ContextTest do
  use ExUnit.Case, async: false

  alias Pi.Project.Context

  test "target environment wins over the bridge working directory" do
    root =
      Path.join(System.tmp_dir!(), "pi-project-context-#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    File.write!(Path.join(root, "mix.exs"), "defmodule Demo.MixProject do\nend\n")

    previous_root = System.get_env("PI_ELIXIR_PROJECT_CWD")
    previous_env = System.get_env("PI_ELIXIR_PROJECT_MIX_ENV")
    System.put_env("PI_ELIXIR_PROJECT_CWD", root)
    System.put_env("PI_ELIXIR_PROJECT_MIX_ENV", "review")

    try do
      context = Context.current()

      assert context.root == Path.expand(root)
      assert context.source == :target_env
      assert context.mix_env == "review"
      assert context.build_path == Path.join([Path.expand(root), "_build", "review"])
      assert Context.mix_project?(context)
      assert Context.resolve(context, "lib/demo.ex") == Path.join(root, "lib/demo.ex")
      assert Context.relative(context, Path.join(root, "lib/demo.ex")) == "lib/demo.ex"

      assert {output, 0} = Context.command(context, "pwd", [])
      assert String.trim(output) == Path.expand(root)
    after
      restore_env("PI_ELIXIR_PROJECT_CWD", previous_root)
      restore_env("PI_ELIXIR_PROJECT_MIX_ENV", previous_env)
      File.rm_rf(root)
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
