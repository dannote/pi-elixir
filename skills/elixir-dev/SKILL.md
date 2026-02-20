---
name: elixir-dev
description: Develop Elixir/Phoenix applications using BEAM runtime introspection. Use when working on Elixir projects with Tidewave installed — evaluate code in the running app, read docs from the runtime, locate sources without grep, query the database, inspect processes.
---

# Elixir Development with BEAM Introspection

You have tools that connect to the running BEAM VM via Tidewave. This gives you powers unique to the Erlang/Elixir ecosystem — the application is alive and you can talk to it.

## Tool Priority

The BEAM knows more about the code than the filesystem. Prefer runtime tools:

| Instead of | Use | Why |
|---|---|---|
| `rg "def create_order"` | `elixir_source reference="MyApp.Orders.create_order/1"` | BEAM knows exact file:line from bytecode |
| Web search for Ecto docs | `elixir_docs reference="Ecto.Changeset.cast/4"` | Exact docs for your exact dep version |
| `bash "mix run -e '...'"` | `elixir_eval code="..."` | Runs inside the app with all modules loaded |
| `bash "sqlite3 ... 'SELECT ...'"` | `elixir_sql query="SELECT ..."` | Runs through the app's Ecto repo |
| Guessing what modules exist | `elixir_schemas` | Lists all Ecto schemas with paths |
| Reading logs from terminal | `elixir_logs tail=20 level="error"` | Structured, filterable |

Fall back to `read`/`edit`/`write`/`bash` for file operations and mix commands (compile, test, format, migrations).

## What `elixir_eval` Can Do

`elixir_eval` runs code inside the running application with IEx helpers available. This is immensely powerful.

### Module Discovery and Introspection

```elixir
# List all exports of a module
exports(MyApp.Orders)

# Get type specs
t(MyApp.Orders)

# Get callback specs for a behaviour
b(GenServer)

# Detailed info about any value
i(%MyApp.Orders.Order{})

# Find all modules matching a pattern
:code.all_loaded() |> Enum.filter(fn {mod, _} -> "#{mod}" =~ "MyApp" end) |> Enum.map(&elem(&1, 0)) |> Enum.sort()
```

### Runtime State Inspection

```elixir
# List all running processes
Process.list() |> length()

# See what's registered
Process.registered() |> Enum.sort()

# Inspect a GenServer's state
:sys.get_state(MyApp.SomeWorker)

# Get detailed process info
process_info(self())

# Runtime info (memory, versions, schedulers)
runtime_info()

# Check ETS tables
:ets.all() |> Enum.map(&:ets.info/1) |> Enum.sort_by(& &1[:memory], :desc) |> Enum.take(10)
```

### Phoenix-Specific Introspection

```elixir
# List all routes
MyAppWeb.Router.__routes__() |> Enum.map(fn r -> {r.verb, r.path, r.plug, r.plug_opts} end)

# Check Endpoint config
Application.get_env(:my_app, MyAppWeb.Endpoint)

# List active PubSub topics
Phoenix.PubSub.node_name(MyApp.PubSub)

# Check what LiveViews are mounted (via their processes)
Process.list()
|> Enum.filter(fn pid ->
  case Process.info(pid, :dictionary) do
    {:dictionary, dict} -> Keyword.get(dict, :"$initial_call") |> elem(0) |> to_string() =~ "LiveView"
    _ -> false
  end
end)
|> length()
```

### Ecto Introspection

```elixir
# List all schema fields
MyApp.Orders.Order.__schema__(:fields)

# Field types
MyApp.Orders.Order.__schema__(:type, :status)

# Associations
MyApp.Orders.Order.__schema__(:associations)

# Check a specific association
MyApp.Orders.Order.__schema__(:association, :items)

# Primary key
MyApp.Orders.Order.__schema__(:primary_key)

# Source table
MyApp.Orders.Order.__schema__(:source)
```

### Testing Hypotheses

```elixir
# Call a function with real data
MyApp.Orders.list_orders(%{status: :pending}) |> length()

# Check what a changeset produces
%MyApp.Orders.Order{}
|> MyApp.Orders.Order.changeset(%{title: "test"})
|> Map.get(:errors)

# Test a query
import Ecto.Query
MyApp.Repo.all(from o in MyApp.Orders.Order, where: o.status == :pending, limit: 5)
```

### AST Manipulation

Elixir's metaprogramming is first-class — use it for code analysis and transformation:

```elixir
# Parse code to AST
Code.string_to_quoted!("""
  def create_order(attrs) do
    %Order{} |> Order.changeset(attrs) |> Repo.insert()
  end
""")

# Convert AST back to code
ast = quote do: Enum.map(list, fn x -> x * 2 end)
Macro.to_string(ast)

# Walk an AST to find all function calls
source = File.read!("lib/my_app/orders.ex")
{:ok, ast} = Code.string_to_quoted(source)
Macro.prewalk(ast, [], fn
  {:., _, [{:__aliases__, _, mod}, fun]} = node, acc -> {node, [{Module.concat(mod), fun} | acc]}
  node, acc -> {node, acc}
end) |> elem(1) |> Enum.uniq()
```

If `Sourceror` is a dependency, it enables precise code rewriting while preserving formatting:

```elixir
source = File.read!("lib/my_app/orders.ex")
Sourceror.parse_string!(source)
|> Sourceror.Zipper.zip()
|> Sourceror.Zipper.traverse(fn zipper -> zipper end)
```

### Erlang/OTP Introspection

The full power of OTP is available:

```elixir
# System info
:erlang.system_info(:schedulers_online)
:erlang.system_info(:process_count)
:erlang.memory() |> Enum.map(fn {k, v} -> {k, "#{Float.round(v / 1_048_576, 1)} MB"} end)

# Application tree
Application.started_applications() |> Enum.map(&elem(&1, 0)) |> Enum.sort()

# Supervision tree
Supervisor.which_children(MyApp.Supervisor) |> Enum.map(fn {id, _, _, _} -> id end)

# Check if a module has specific functions
function_exported?(MyApp.Orders, :create_order, 1)

# Module info from the BEAM
MyApp.Orders.module_info(:attributes)
MyApp.Orders.module_info(:compile)
```

### Debugging Workflow

```elixir
# Clear logs before an operation
Tidewave.clear_logs()
```

Then use `elixir_logs` to read only fresh output after the operation.

## Workflow

1. **Explore** — `elixir_source`, `elixir_docs`, `elixir_eval` with `exports/1` and `i/1`
2. **Edit** — `read`/`edit`/`write` for file changes
3. **Verify** — `bash "mix compile"`, `elixir_logs` for errors
4. **Test** — `bash "mix test test/path.exs:42"` or `bash "mix test --failed"`
5. **Format** — `bash "mix format"`
