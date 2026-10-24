/**
 * @fileoverview How the AI service reads provider errors: which to retry,
 * which stop the call, and the message to show.
 */

// A call that timed out or was cancelled; no retry or other role should run
export function isAbort(error: any): boolean {
	return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

export function isRetryableError(error: any): boolean {
	const errorMessage = error?.message?.toLowerCase() || '';
	// A call we gave up on stays given up; retrying would wait out the limit again
	if (isAbort(error) || errorMessage.includes('aborted')) {
		return false;
	}
	// The AI SDK already retried it (up to 3 calls); retrying again makes it 9
	if (
		error?.name === 'AI_RetryError' ||
		error?.cause?.name === 'AI_RetryError'
	) {
		return false;
	}
	return (
		errorMessage.includes('rate limit') ||
		errorMessage.includes('overloaded') ||
		errorMessage.includes('service temporarily unavailable') ||
		errorMessage.includes('timeout') ||
		errorMessage.includes('network error') ||
		error?.status === 429 ||
		error?.status >= 500
	);
}

/**
 * Extracts a user-friendly error message from a potentially complex AI error object.
 * Prioritizes nested messages and falls back to the top-level message.
 */
export function extractErrorMessage(error: any): string {
	try {
		if (error?.data?.error?.message) {
			return error.data.error.message;
		}

		if (error?.error?.message) {
			return error.error.message;
		}

		if (typeof error?.responseBody === 'string') {
			try {
				const body = JSON.parse(error.responseBody);
				if (body?.error?.message) {
					return body.error.message;
				}
			} catch {
				// Ignore if responseBody is not valid JSON
			}
		}

		if (typeof error?.message === 'string' && error.message) {
			return error.message;
		}

		if (typeof error === 'string') {
			return error;
		}

		return 'An unknown AI service error occurred.';
	} catch {
		return 'Failed to extract error message.';
	}
}
