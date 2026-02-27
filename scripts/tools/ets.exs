format_mem = fn bytes ->
  cond do
    bytes >= 1_048_576 -> "#{Float.round(bytes * 8 / 1_048_576, 1)} MB"
    bytes >= 1024 -> "#{Float.round(bytes * 8 / 1024, 1)} KB"
    true -> "#{bytes * 8} B"
  end
end

case table_name do
  nil ->
    tables =
      :ets.all()
      |> Enum.map(fn tid ->
        try do
          info = :ets.info(tid)
          if info == :undefined, do: nil, else: Map.new(info)
        rescue
          _ -> nil
        end
      end)
      |> Enum.reject(&is_nil/1)
      |> Enum.sort_by(& &1[String.to_existing_atom(sort_by)], :desc)

    header = String.pad_trailing("Name", 40) <> String.pad_leading("Size", 10) <> String.pad_leading("Memory", 12) <> "  Type       Protection  Owner"

    lines = Enum.map(tables, fn t ->
      name = inspect(t[:name])
      String.pad_trailing(name, 40) <>
        String.pad_leading("#{t[:size]}", 10) <>
        String.pad_leading(format_mem.(t[:memory]), 12) <>
        "  " <> String.pad_trailing("#{t[:type]}", 11) <>
        String.pad_trailing("#{t[:protection]}", 12) <>
        inspect(t[:owner])
    end)

    "#{length(tables)} ETS tables (sorted by #{sort_by})\n\n" <> header <> "\n" <> Enum.join(lines, "\n")

  name ->
    table =
      case Integer.parse(name) do
        {n, ""} -> :ets.whereis(n)
        _ ->
          try do
            if String.starts_with?(name, ":") do
              name |> String.trim_leading(":") |> String.to_existing_atom()
            else
              String.to_existing_atom(name)
            end
          rescue
            ArgumentError -> nil
          end
      end

    case :ets.info(table) do
      :undefined -> "ETS table not found: #{name}"
      info ->
        info = Map.new(info)

        header = """
        Name:       #{inspect(info[:name])}
        ID:         #{inspect(info[:id])}
        Type:       #{info[:type]}
        Protection: #{info[:protection]}
        Owner:      #{inspect(info[:owner])}
        Size:       #{info[:size]} objects
        Memory:     #{format_mem.(info[:memory])}
        Compressed: #{info[:compressed]}
        """

        rows = try do
          case match_pattern do
            nil ->
              :ets.tab2list(table)
            pattern_str ->
              {pattern, _} = Code.eval_string(pattern_str)
              :ets.match_object(table, pattern)
          end
        rescue
          e -> {:error, Exception.message(e)}
        end

        case rows do
          {:error, msg} ->
            header <> "\nError reading table: #{msg}"
          rows ->
            total = length(rows)
            rows = Enum.take(rows, max_rows)
            content = Enum.map_join(rows, "\n", fn row ->
              inspect(row, pretty: true, limit: 10, width: 120)
            end)
            suffix = if total > max_rows, do: "\n\n(#{total} total, showing first #{max_rows})", else: ""
            header <> "\nContents (#{total} rows):\n\n" <> content <> suffix
        end
    end
end
