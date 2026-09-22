/** Any thrown value as an `Error`, keeping the original when it already is one. */
export function toError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(typeof error === "string" ? error : JSON.stringify(error));
}

/** The message of any thrown value, for notices and reports. */
export function errorMessage(error: unknown): string {
	return toError(error).message;
}
