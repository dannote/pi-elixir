defmodule Pi.ASTTest do
  use ExUnit.Case, async: false

  test "search includes test and script exs files" do
    in_tmp_dir(fn ->
      File.mkdir_p!("test/demo")

      File.write!("test/demo/native_ref_test.exs", """
      defmodule Demo.NativeRefTest do
        use ExUnit.Case

        test "matches struct aliases" do
          assert %RustQ.Native.Ref{target: "Canvas"}
        end
      end
      """)

      assert {:ok, result} = Pi.AST.search("%RustQ.Native.Ref{}", path: "test")
      assert result.total == 1
      assert [%{file: file, line: 5}] = result.matches
      assert file == "test/demo/native_ref_test.exs"
    end)
  end

  test "replace edits exs files" do
    in_tmp_dir(fn ->
      File.mkdir_p!("test/demo")
      path = "test/demo/native_ref_test.exs"
      File.write!(path, "value = %RustQ.NativeRef{target: \"Canvas\"}\n")

      assert {:ok, result} = Pi.AST.replace("RustQ.NativeRef", "RustQ.Native.Ref", path: "test")

      assert result.total == 1
      assert File.read!(path) == "value = %RustQ.Native.Ref{target: \"Canvas\"}\n"
    end)
  end

  test "diff compares a changed file against git HEAD" do
    in_git_repo(fn ->
      File.mkdir_p!("lib")

      File.write!("lib/demo.ex", """
      defmodule Demo do
        def run(value), do: value + 1
      end
      """)

      git!(~w[add lib/demo.ex])
      git!(~w[commit -m initial])

      File.write!("lib/demo.ex", """
      defmodule Demo do
        def run(value), do: value + 2
      end
      """)

      assert %Pi.Output{} = output = Pi.AST.diff(path: "lib/demo.ex")
      assert [part] = output.parts
      assert part.title =~ "Elixir syntax diff:"
      refute part.title =~ "0 AST edit"
      assert part.body =~ "changed public Demo.run/1"
      refute part.body =~ "insert function defmodule"
    end)
  end

  defp in_tmp_dir(fun) do
    dir = Path.join(System.tmp_dir!(), "pi-ast-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)

    try do
      File.cd!(dir, fun)
    after
      File.rm_rf(dir)
    end
  end

  defp in_git_repo(fun) do
    dir = Path.join(System.tmp_dir!(), "pi-ast-diff-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)

    try do
      File.cd!(dir, fn ->
        git!(~w[init])
        git!(~w[config user.email test@example.com])
        git!(~w[config user.name Test])
        fun.()
      end)
    after
      File.rm_rf(dir)
    end
  end

  defp git!(args) do
    assert {_output, 0} = System.cmd("git", args, stderr_to_stdout: true)
  end
end
