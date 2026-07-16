defmodule Pi.OutputTest do
  use ExUnit.Case, async: true

  defmodule ExampleStruct do
    defstruct [:name, :child]
  end

  test "tree output renders structs inside nested maps" do
    value = %{items: [%ExampleStruct{name: :ok, child: %{count: 1}}]}

    assert %Pi.Output{} = Pi.Output.tree(value)
  end

  test "published output dispatch helpers retain their return contract" do
    value = [%{name: "alpha", count: 1}]

    assert %Pi.Output{parts: parts} = output = Pi.Output.output(value)
    assert Pi.Output.auto(output) == output
    assert Pi.Output.parts_for(value) == parts
  end
end
