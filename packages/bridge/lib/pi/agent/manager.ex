defmodule Pi.Agent.Manager do
  @moduledoc "Agent job lifecycle manager."

  use GenServer

  alias Pi.Agent.Events
  alias Pi.Agent.Job
  alias Pi.Agent.JobSupervisor
  alias Pi.Supervisor.Install

  defstruct jobs: %{}

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def install do
    with :ok <- normalize_install(JobSupervisor.install()),
         do: Install.ensure(__MODULE__)
  end

  defp normalize_install(:ok), do: :ok
  defp normalize_install(error), do: error

  def start_job(task, opts \\ []) when is_binary(task) do
    install()
    GenServer.call(__MODULE__, {:start_job, task, opts})
  end

  def jobs do
    install()
    GenServer.call(__MODULE__, :jobs)
  end

  def status(id) when is_binary(id) do
    install()
    GenServer.call(__MODULE__, {:status, id})
  end

  def result(id) when is_binary(id) do
    install()
    GenServer.call(__MODULE__, {:result, id})
  end

  def cancel(id) when is_binary(id) do
    install()
    GenServer.call(__MODULE__, {:cancel, id})
  end

  @impl true
  def init(_opts) do
    Events.register(self())
    {:ok, %__MODULE__{}}
  end

  @impl true
  def terminate(_reason, _state), do: Events.unregister(self())

  @impl true
  def handle_call({:start_job, task, opts}, _from, state) do
    job = Job.new(task, opts)

    case JobSupervisor.start_job(job, opts) do
      {:ok, pid} ->
        job = %{job | pid: pid}
        Process.monitor(pid)
        {:reply, {:ok, job}, put_in(state.jobs[job.id], job)}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call(:jobs, _from, state) do
    jobs =
      state.jobs
      |> Map.values()
      |> Enum.sort_by(&(&1.started_at || DateTime.utc_now()), {:desc, DateTime})

    {:reply, jobs, state}
  end

  def handle_call({:status, id}, _from, state) do
    {:reply, fetch_job(state, id), state}
  end

  def handle_call({:result, id}, _from, state) do
    reply =
      case Map.fetch(state.jobs, id) do
        {:ok, %Job{status: :done, result: result}} -> {:ok, result}
        {:ok, %Job{status: :failed, error: error}} -> {:error, error}
        {:ok, %Job{status: :cancelled}} -> {:error, :cancelled}
        {:ok, %Job{status: status}} -> {:error, status}
        :error -> {:error, :not_found}
      end

    {:reply, reply, state}
  end

  def handle_call({:cancel, id}, _from, state) do
    reply =
      case Map.fetch(state.jobs, id) do
        {:ok, %Job{pid: pid, status: :running}} when is_pid(pid) -> Job.cancel(pid)
        {:ok, _job} -> :ok
        :error -> {:error, :not_found}
      end

    {:reply, reply, state}
  end

  @impl true
  def handle_info({:job_finished, %Job{} = job}, state) do
    {:noreply, put_in(state.jobs[job.id], job)}
  end

  def handle_info({:DOWN, _ref, :process, pid, reason}, state) do
    case Enum.find(state.jobs, fn {_id, job} -> job.pid == pid and job.status == :running end) do
      {id, job} ->
        job = %{
          job
          | status: :failed,
            error: reason,
            finished_at: DateTime.utc_now()
        }

        {:noreply, put_in(state.jobs[id], job)}

      nil ->
        {:noreply, state}
    end
  end

  defp fetch_job(state, id) do
    case Map.fetch(state.jobs, id) do
      {:ok, job} -> {:ok, job}
      :error -> {:error, :not_found}
    end
  end
end
