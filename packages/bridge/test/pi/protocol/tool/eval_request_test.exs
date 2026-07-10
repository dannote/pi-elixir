defmodule Pi.Protocol.Tool.EvalRequestTest do
  use ExUnit.Case, async: true

  alias Pi.Protocol.Tool.EvalRequest

  test "JSON decoding is the only representation boundary" do
    assert {:ok, %EvalRequest{mode: :trusted, target: :project}} =
             EvalRequest.from_map(%{"code" => "1 + 1"})

    assert {:ok, %EvalRequest{mode: :sandbox, target: :runtime}} =
             EvalRequest.from_map(%{
               "code" => "1 + 1",
               "mode" => "sandbox",
               "target" => "runtime"
             })

    assert {:ok, %EvalRequest{target: :application}} =
             EvalRequest.from_map(%{"code" => "1 + 1", "target" => "application"})
  end

  test "rejects unknown enum values instead of leaking strings internally" do
    assert {:error, _reason} =
             EvalRequest.from_map(%{"code" => "1 + 1", "target" => "remote-ish"})
  end
end
