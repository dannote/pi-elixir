let requestId = 0;

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: {
		content?: Array<{ type: string; text: string }>;
		isError?: boolean;
	};
	error?: { code: number; message: string };
}

export async function callTool(
	url: string,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ text: string; isError: boolean }> {
	const id = ++requestId;

	let resp: Response;
	try {
		resp = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method: "tools/call",
				params: { name, arguments: args },
			}),
			signal,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			text: `Could not reach BEAM at ${url} (${msg}). Is the Phoenix server running?`,
			isError: true,
		};
	}

	let json: JsonRpcResponse;
	try {
		json = await resp.json();
	} catch {
		return {
			text: `BEAM returned invalid response (HTTP ${resp.status}). The server may be starting up or misconfigured.`,
			isError: true,
		};
	}

	if (json.error) {
		return { text: `MCP error ${json.error.code}: ${json.error.message}`, isError: true };
	}

	const text = (json.result?.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return { text, isError: json.result?.isError ?? false };
}

export async function isReachable(url: string): Promise<boolean> {
	try {
		const resp = await fetch(url.replace(/\/mcp$/, "/config"), {
			signal: AbortSignal.timeout(2000),
		});
		return resp.ok;
	} catch {
		return false;
	}
}
