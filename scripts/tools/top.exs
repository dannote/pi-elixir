sort_key = String.to_existing_atom(sort_by)

Process.list()
|> Enum.map(fn pid ->
  info = Process.info(pid, [:registered_name, :memory, :message_queue_len, :reductions, :current_function, :initial_call, :dictionary])
  case info do
    nil -> nil
    info ->
      name = case info[:registered_name] do
        [] -> nil
        n -> n
      end
      init_call = case info[:dictionary][:"$initial_call"] do
        {m, f, a} -> "#{inspect(m)}.#{f}/#{a}"
        _ -> case info[:initial_call] do
          {m, f, a} -> "#{inspect(m)}.#{f}/#{a}"
          _ -> nil
        end
      end
      current = case info[:current_function] do
        {m, f, a} -> "#{inspect(m)}.#{f}/#{a}"
        _ -> "?"
      end
      label = cond do
        name -> inspect(name)
        init_call -> init_call
        true -> inspect(pid)
      end
      %{
        pid: inspect(pid),
        name: label,
        memory: info[:memory],
        message_queue_len: info[:message_queue_len],
        reductions: info[:reductions],
        current: current
      }
  end
end)
|> Enum.reject(&is_nil/1)
|> Enum.sort_by(& &1[sort_key], :desc)
|> Enum.take(max_results)
|> Enum.with_index(1)
|> Enum.map(fn {p, i} ->
  mem = cond do
    p.memory >= 1_048_576 -> "#{Float.round(p.memory / 1_048_576, 1)} MB"
    p.memory >= 1024 -> "#{Float.round(p.memory / 1024, 1)} KB"
    true -> "#{p.memory} B"
  end
  rank = String.pad_leading("#{i}", 3)
  "#{rank}. #{p.pid} #{String.pad_trailing(p.name, 48)} mem=#{String.pad_leading(mem, 10)} msgq=#{String.pad_leading("#{p.message_queue_len}", 6)} reds=#{p.reductions}"
end)
|> Enum.join("\n")
