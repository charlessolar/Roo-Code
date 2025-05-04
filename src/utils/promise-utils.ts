/**
 * Wraps a promise with a timeout
 *
 * @param promise The promise to add a timeout to
 * @param timeoutMs The timeout in milliseconds
 * @param errorMessage The error message to throw on timeout
 * @returns A promise that resolves with the result of the original promise or rejects with a timeout error
 */
export async function promiseTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	errorMessage = "Operation timed out",
): Promise<T> {
	let timeoutId: NodeJS.Timeout

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(errorMessage))
		}, timeoutMs)
	})

	try {
		return await Promise.race([promise, timeoutPromise])
	} finally {
		clearTimeout(timeoutId!)
	}
}
