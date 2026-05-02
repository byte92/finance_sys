export class ClientApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
  }
}

type ReadJsonOptions = {
  fallbackMessage: string;
  unavailableMessage?: string;
};

function unavailableMessage(options: ReadJsonOptions) {
  return options.unavailableMessage ?? "服务暂时不可用，请稍后重试。";
}

function responseSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function extractErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { error?: unknown; message?: unknown };
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return null;
}

function isLowLevelErrorMessage(message: string) {
  return /Unexpected token|not valid JSON|<!DOCTYPE|<html|SQLITE_|better-sqlite3/i.test(message);
}

function httpErrorMessage(response: Response, payload: unknown, options: ReadJsonOptions) {
  const apiMessage = extractErrorMessage(payload);
  if (apiMessage) {
    return isLowLevelErrorMessage(apiMessage) ? unavailableMessage(options) : apiMessage;
  }

  if (response.status === 401 || response.status === 403) {
    return "没有权限访问该服务，请刷新页面后重试。";
  }
  if (response.status === 404) {
    return "请求的服务不存在，请刷新页面后重试。";
  }
  if (response.status === 429) {
    return "请求过于频繁，请稍后再试。";
  }
  if (response.status >= 500) {
    return unavailableMessage(options);
  }
  return options.fallbackMessage;
}

export async function readJsonResponse<T>(response: Response, options: ReadJsonOptions): Promise<T> {
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    console.error("Failed to read API response:", error);
    throw new ClientApiError(unavailableMessage(options), response.status);
  }

  let payload: unknown = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      console.error("API returned a non-JSON response:", {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: responseSnippet(text),
        error,
      });
      throw new ClientApiError(unavailableMessage(options), response.status);
    }
  }

  if (!response.ok) {
    throw new ClientApiError(httpErrorMessage(response, payload, options), response.status);
  }

  return payload as T;
}

export function describeClientRequestError(
  error: unknown,
  fallbackMessage: string,
  unavailable = "服务暂时不可用，请稍后重试。",
) {
  if (error instanceof ClientApiError) return error.message;

  if (error instanceof TypeError) {
    return "服务暂时不可用，请检查网络后重试。";
  }

  if (error instanceof Error) {
    if (isLowLevelErrorMessage(error.message) || /JSON/i.test(error.message)) {
      return unavailable;
    }
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}
