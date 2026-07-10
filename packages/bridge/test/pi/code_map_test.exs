defmodule Pi.CodeMapTest do
  use ExUnit.Case, async: false

  alias Pi.Bridge.Info
  alias Pi.CodeMap

  setup do
    dir = Path.join(System.tmp_dir!(), "pi-code-map-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(dir, "lib"))

    file = Path.join(dir, "lib/sample.ex")

    File.write!(file, """
    defmodule Sample.CodeMapTarget do
      def public(value) do
        value
        |> helper()
        |> to_string()
      end

      def helper(value) do
        if value in [nil, false], do: :empty, else: {:ok, value}
      end

      def unsafe_atom(value), do: String.to_atom(value)

      def repeated_maps(value) do
        [%{first: value, second: value, third: value}]
        [%{first: value, second: value, third: value}]
        [%{first: value, second: value, third: value}]
      end
    end
    """)

    on_exit(fn -> File.rm_rf(dir) end)

    %{source_file: file}
  end

  test "summarizes and resolves functions with Reach", %{source_file: file} do
    project = CodeMap.project(paths: [file])

    assert %{"functions" => functions, "modules" => 1} = CodeMap.summary(project: project)
    assert functions >= 2

    assert %Pi.CodeMap.FunctionRef{target: target, file: ^file} =
             CodeMap.find("public/1", project: project)

    assert target =~ "public/1"

    assert [%{"id" => %{"label" => helper}} | _] =
             CodeMap.callees("public/1", project: project, depth: 1)

    assert helper =~ "helper/1"
  end

  test "returns module-level context for module targets", %{source_file: file} do
    project = CodeMap.project(paths: [file])

    assert %{
             "kind" => ":module",
             "target" => "Sample.CodeMapTarget",
             "module" => %{"file" => ^file, "functions" => 4},
             "functions" => functions
           } = CodeMap.context(Sample.CodeMapTarget, project: project)

    assert Enum.any?(functions, &(&1["target"] =~ "public/1"))
    assert Enum.any?(functions, &(&1["target"] =~ "helper/1"))
  end

  test "normalizes, path-filters, and prioritizes Reach smell findings", %{source_file: file} do
    project = CodeMap.project(paths: [file])
    findings = CodeMap.smells(project: project, path: file, top: 50)

    assert %Pi.CodeMap.Smell{
             kind: "unsafe_atom_creation",
             file: ^file,
             line: line
           } = Enum.find(findings, &(&1.kind == "unsafe_atom_creation"))

    assert is_integer(line) and line > 0
    refute Enum.any?(findings, &String.starts_with?(&1.kind || "", ":"))

    assert unsafe_index = Enum.find_index(findings, &(&1.kind == "unsafe_atom_creation"))
    assert shape_index = Enum.find_index(findings, &(&1.kind == "fixed_shape_map"))
    assert unsafe_index < shape_index

    assert [%Pi.CodeMap.Smell{kind: "unsafe_atom_creation"}] =
             CodeMap.smells(project: project, top: 1)
  end

  test "reflection returns a recommendation and evidence shape", %{source_file: file} do
    project = CodeMap.project(paths: [file])

    reflection = CodeMap.reflect(project: project, paths: [file])

    assert %Pi.CodeMap.Reflection{} = reflection
    assert reflection.command == "Pi.CodeMap.reflect"
    assert [%Pi.CodeMap.FunctionRef{} | _] = reflection.changed_functions
    assert is_list(reflection.hotspots)
    assert is_list(reflection.smells)
    assert is_binary(reflection.recommendation)
    assert %Pi.Output{} = output = Pi.Output.output(reflection)

    assert [
             %Pi.Protocol.Tool.OutputPart{kind: :text, body: summary},
             %Pi.Protocol.Tool.OutputPart{kind: :tree, title: title}
           ] = output.parts

    assert summary =~ "Review before final"
    assert summary =~ "changed func"
    refute title == "CodeMap reflection"
  end

  test "default project root is explicit and independent from bridge cwd", %{source_file: file} do
    root = file |> Path.dirname() |> Path.dirname()
    previous = System.get_env("PI_ELIXIR_PROJECT_CWD")
    System.put_env("PI_ELIXIR_PROJECT_CWD", root)

    try do
      project = CodeMap.project()

      assert %{"modules" => 1} = CodeMap.summary(project: project)

      assert %Pi.CodeMap.FunctionRef{file: ^file} =
               CodeMap.find("public/1", project: project)
    after
      if previous,
        do: System.put_env("PI_ELIXIR_PROJECT_CWD", previous),
        else: System.delete_env("PI_ELIXIR_PROJECT_CWD")
    end
  end

  test "eval prelude aliases CodeMap" do
    assert Info.aliases_code() =~ "alias Pi.CodeMap, as: CodeMap"
  end
end
