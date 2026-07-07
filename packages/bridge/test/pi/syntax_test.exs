defmodule Pi.SyntaxTest do
  use ExUnit.Case, async: true

  test "returns Lumis scope spans with rainbow bracket scopes" do
    assert {:ok, %{engine: "lumis", language: "elixir", lines: [line]}} =
             Pi.Syntax.highlight("{:ok, [1]}", language: :elixir)

    assert Enum.map_join(line, & &1.text) == "{:ok, [1]}"

    assert Enum.any?(line, fn span ->
             "punctuation-bracket-rainbow-1-elixir" in span.scopes
           end)

    assert Enum.any?(line, fn span ->
             "punctuation-bracket-rainbow-2-elixir" in span.scopes
           end)
  end

  test "metadata is empty for oversized inputs" do
    source = String.duplicate("{", 101 * 1024)
    assert Pi.Syntax.metadata(source, language: :elixir) == %{}
  end
end
