"use client";

import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useState } from "react";
import { LogoFull } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { signIn } from "@/lib/actions";
import storeFront from "./store-front.jpg";

/** The page to go back to after signing in (the proxy adds ?next= when it sends someone here) */
function NextField() {
  const next = useSearchParams().get("next") ?? "/";
  return <input type="hidden" name="next" value={next} />;
}

const fieldIcon = "pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-slate-400";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, { error: "" });
  // Kept here so a wrong password doesn't clear it (form actions reset the form)
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-white xl:grid xl:grid-cols-[1fr_420px] 2xl:grid-cols-[1fr_460px]">
      {/* Shop photo: across the top on phones and tablets, the left side on wide screens */}
      <div className="relative aspect-4/3 max-h-[42vh] w-full shrink-0 xl:aspect-auto xl:max-h-none xl:p-4">
        <div className="relative size-full overflow-hidden xl:rounded-3xl">
          {/* Crops more sky than paving (70%), and the sides evenly: the sign spans almost the whole photo */}
          <Image
            src={storeFront}
            alt="The Ananda Stores shop, Raigam distributor, at Wijitha Stores, Dandeniya, Opanayaka"
            fill
            placeholder="blur"
            loading="eager"
            fetchPriority="high"
            sizes="(min-width: 1280px) calc(100vw - 420px), 100vw"
            className="object-cover object-[50%_70%]"
          />
        </div>
      </div>

      {/* Form: slides up over the photo on phones and tablets */}
      <div className="relative -mt-6 flex flex-1 flex-col items-center justify-center rounded-t-3xl bg-white px-6 pt-8 pb-10 sm:px-12 xl:mt-0 xl:rounded-none xl:px-10 xl:py-12 2xl:px-12">
        <div className="w-full max-w-sm">
          <LogoFull width={208} className="mx-auto h-auto w-36 sm:w-44 xl:w-52" />

          <div className="mt-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-brand-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
          </div>

          <form action={formAction} className="mt-7 flex flex-col gap-4">
            <Suspense>
              <NextField />
            </Suspense>
            <Field label="Email" htmlFor="email">
              <div className="relative">
                <Mail className={fieldIcon} />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="h-12 pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </Field>
            <Field label="Password" htmlFor="password">
              <div className="relative">
                <Lock className={fieldIcon} />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  required
                  className="h-12 pr-11 pl-10"
                  aria-describedby={state.error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
            </Field>
            {state.error && (
              <p id="login-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending} className="mt-1 h-12 w-full text-base shadow-lg shadow-brand-600/25">
              {pending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-slate-500">Forgot your password? Ask the owner to reset it.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
