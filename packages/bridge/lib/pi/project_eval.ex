defmodule Pi.ProjectEval do
  @moduledoc "Runs eval snippets in a separate target-project VM without loading pi_bridge there."

  alias Pi.Protocol.Tool.Eval, as: EvalPayload
  alias Pi.Protocol.Tool.OutputPart

  @marker "__PI_ELIXIR_EVAL_RESULT__"

  def run(code, opts \\ []) when is_binary(code) do
    case run_external(code, opts) do
      {:ok, %{text: text}} -> {:ok, text}
      {:error, reason} -> {:error, reason}
    end
  end

  def run_structured(code, opts \\ []) when is_binary(code) do
    case run_external(code, opts) do
      {:ok, %{text: text, io: io, success?: true}} ->
        parts =
          []
          |> maybe_io_part(io)
          |> Kernel.++([
            OutputPart.inspect(text,
              language: :elixir,
              data: Pi.Syntax.metadata(text, language: :elixir)
            )
          ])

        {:ok, %EvalPayload{io: io, result: text, text: text, parts: parts}}

      {:ok, %{text: text, io: io, success?: false}} ->
        parts = [] |> maybe_io_part(io) |> Kernel.++([OutputPart.error(text)])
        {:error, %EvalPayload{io: io, error: text, text: text, parts: parts}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def available? do
    project_cwd() not in [nil, ""]
  end

  defp run_external(code, opts) do
    cwd = project_cwd()
    timeout = Keyword.get(opts, :timeout, 30_000)

    try do
      if is_binary(cwd) and File.exists?(Path.join(cwd, "mix.exs")) do
        encoded = Base.encode64(code)
        wrapper = wrapper(encoded)

        case System.cmd("mix", ["run", "-e", wrapper],
               cd: cwd,
               stderr_to_stdout: true,
               env: mix_env()
             ) do
          {output, 0} -> decode_output(output)
          {output, code} -> {:error, "mix run exited with code #{code}\n\n#{output}"}
        end
      else
        {:error, "No target Mix project configured for isolated project eval."}
      end
    catch
      :exit, {:timeout, _} -> {:error, "Evaluation timed out after #{timeout}ms"}
    end
  end

  defp project_cwd, do: System.get_env("PI_ELIXIR_PROJECT_CWD")

  defp mix_env do
    [
      {"MIX_ENV", System.get_env("MIX_ENV") || "dev"},
      {"PI_ELIXIR_PROJECT_EVAL", "1"}
    ]
  end

  defp decode_output(output) do
    case String.split(output, @marker, parts: 2) do
      [_before, encoded] ->
        encoded
        |> String.trim()
        |> Base.decode64!()
        |> :erlang.binary_to_term([:safe])

      _ ->
        {:error, output}
    end
  rescue
    exception in [ArgumentError] ->
      {:error,
       "Could not decode project eval result: #{Exception.message(exception)}\n\n#{output}"}
  end

  defp wrapper(encoded) do
    escaped = inspect(encoded)
    marker = inspect(@marker)

    """
    code = Base.decode64!(#{escaped})
    old_gl = Process.group_leader()
    {:ok, capture} = StringIO.open("")
    Process.group_leader(self(), capture)

    result =
      try do
        {value, _binding} = Code.eval_string(code, [arguments: []], __ENV__)
        {:ok, inspect(value, pretty: true, limit: 50, printable_limit: 4096), ""}
      catch
        kind, reason ->
          {:error, Exception.format(kind, reason, __STACKTRACE__), ""}
      after
        Process.group_leader(self(), old_gl)
      end

    {_input, io} = StringIO.contents(capture)

    payload =
      case result do
        {:ok, text, _} -> {:ok, %{success?: true, text: text, io: io}}
        {:error, text, _} -> {:ok, %{success?: false, text: text, io: io}}
      end

    IO.puts(#{marker} <> Base.encode64(:erlang.term_to_binary(payload)))
    """
  end

  defp maybe_io_part(parts, ""), do: parts
  defp maybe_io_part(parts, io), do: parts ++ [OutputPart.text(io)]
end
