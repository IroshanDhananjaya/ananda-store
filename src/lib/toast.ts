import { toast as sonner } from "sonner";

/**
 * The app's pop-up messages. Same as sonner's toast, except errors stay on screen until closed
 * (or 20 seconds): they say what went wrong and how to fix it, and are easy to miss while
 * looking at a paper bill. Success messages still go away by themselves.
 */
export const toast = Object.assign((...args: Parameters<typeof sonner>) => sonner(...args), sonner, {
  error: (message: Parameters<typeof sonner.error>[0], options?: Parameters<typeof sonner.error>[1]) =>
    sonner.error(message, { duration: 20_000, ...options }),
});
