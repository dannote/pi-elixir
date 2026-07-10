defmodule Pi.Target.Runtime.Transport do
  @moduledoc false

  def send_term(socket, term) do
    :gen_tcp.send(socket, :erlang.term_to_binary(term))
  end

  def recv_term(socket, timeout) do
    with {:ok, binary} <- :gen_tcp.recv(socket, 0, timeout) do
      {:ok, :erlang.binary_to_term(binary, [:safe])}
    end
  rescue
    _exception in [ArgumentError] -> {:error, :invalid_term}
  end

  def recv_trusted_term(socket, timeout) do
    with {:ok, binary} <- :gen_tcp.recv(socket, 0, timeout) do
      # sobelow_skip ["BinToTerm"] — authenticated loopback worker; target atoms are expected.
      {:ok, :erlang.binary_to_term(binary)}
    end
  rescue
    _exception in [ArgumentError] -> {:error, :invalid_term}
  end
end
