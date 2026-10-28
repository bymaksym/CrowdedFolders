/** The command line is wrong: said in one line, with the exit code 2. */
export class UsageError extends Error {
    override readonly name = 'UsageError';
}
