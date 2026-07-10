defmodule Pi.Project.Context do
  @moduledoc "Explicit filesystem and Mix context for the target project."

  @enforce_keys [:root, :mix_file, :mix_env, :build_path, :source]
  defstruct [:root, :mix_file, :mix_env, :build_path, :app, :source]

  @type t :: %__MODULE__{
          root: Path.t(),
          mix_file: Path.t(),
          mix_env: String.t(),
          build_path: Path.t(),
          app: atom() | nil,
          source: :explicit | :target_env | :cwd
        }

  @spec current(keyword()) :: t()
  def current(opts \\ []) do
    {root, source} = project_root(opts)
    mix_env = mix_env(opts)

    %__MODULE__{
      root: root,
      mix_file: Path.join(root, "mix.exs"),
      mix_env: mix_env,
      build_path: Path.join([root, "_build", mix_env]),
      app: Keyword.get(opts, :app),
      source: source
    }
  end

  @spec resolve(t(), Path.t()) :: Path.t()
  def resolve(%__MODULE__{root: root}, path) when is_binary(path) do
    if Path.type(path) == :absolute, do: Path.expand(path), else: Path.expand(path, root)
  end

  @spec relative(t(), Path.t()) :: Path.t()
  def relative(%__MODULE__{root: root} = context, path) when is_binary(path) do
    context
    |> resolve(path)
    |> Path.relative_to(root)
  end

  @spec command(t(), String.t(), [String.t()], keyword()) :: {String.t(), non_neg_integer()}
  def command(%__MODULE__{root: root}, command, args, opts \\ []) do
    System.cmd(command, args, Keyword.put_new(opts, :cd, root))
  end

  @spec mix_project?(t()) :: boolean()
  def mix_project?(%__MODULE__{mix_file: mix_file}), do: File.regular?(mix_file)

  defp project_root(opts) do
    case Keyword.get(opts, :root) do
      root when is_binary(root) and root != "" -> {Path.expand(root), :explicit}
      _other -> env_or_cwd()
    end
  end

  defp env_or_cwd do
    case System.get_env("PI_ELIXIR_PROJECT_CWD") do
      root when is_binary(root) and root != "" -> {Path.expand(root), :target_env}
      _other -> {File.cwd!(), :cwd}
    end
  end

  defp mix_env(opts) do
    opts
    |> Keyword.get_lazy(:mix_env, fn ->
      System.get_env("PI_ELIXIR_PROJECT_MIX_ENV") || System.get_env("MIX_ENV") || "dev"
    end)
    |> to_string()
  end
end
