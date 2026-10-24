"use client";

import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState } from "react";
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
  // Signed in: open the app as a fresh page, so a zoom left on this page (iPhone) doesn't carry over
  useEffect(() => {
    if (state.next) window.location.replace(state.next);
  }, [state.next]);
  const signingIn = pending || Boolean(state.next);
  // Kept here so a wrong password doesn't clear it (form actions reset the form)
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-white xl:grid xl:grid-cols-[1fr_420px] 2xl:grid-cols-[1fr_460px]">
      {/*
        Shop photo: across the top on phones and tablets, the left side on wide screens.
        On phones it takes the space the form leaves, so the whole page fits on the screen
        without scrolling; never taller than the photo (4:3), as the sides can't be cut.
      */}
      <div className="relative min-h-32 w-full grow max-h-[75vw] xl:max-h-none">
        <div className="absolute inset-0 overflow-hidden xl:inset-4 xl:rounded-3xl">
          {/*
            Short banner on phones: crops the top and bottom, keeping the sign and the shop front (35%).
            Wide screens crop more sky than paving (70%). The sign spans almost the whole width.
          */}
          <Image
            src={storeFront}
            alt="The Ananda Stores shop, Raigam distributor, at Wijitha Stores, Dandeniya, Opanayaka"
            fill
            placeholder="blur"
            loading="eager"
            fetchPriority="high"
            sizes="(min-width: 1280px) calc(100vw - 420px), 100vw"
            className="object-cover object-[50%_35%] xl:object-[50%_70%]"
          />
        </div>
      </div>

      {/* Form: slides up over the photo on phones and tablets */}
      <div className="relative -mt-6 flex flex-col items-center justify-center rounded-t-3xl bg-white px-6 pt-6 pb-6 short:pt-5 short:pb-4 sm:px-12 sm:pt-8 sm:pb-10 xl:mt-0 xl:rounded-none xl:px-10 xl:py-12 2xl:px-12">
        <div className="w-full max-w-sm">
          <LogoFull width={208} className="mx-auto h-auto w-28 short:w-20 sm:w-44 xl:w-52" />

          <div className="mt-4 text-center short:mt-3 sm:mt-6">
            <h1 className="text-2xl font-bold tracking-tight text-brand-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
          </div>

          <form action={formAction} className="mt-5 flex flex-col gap-4 short:mt-4 short:gap-3 sm:mt-7">
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
                  className="h-12 pl-10 short:h-11"
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
                  className="h-12 pr-11 pl-10 short:h-11"
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
            <Button type="submit" disabled={signingIn} className="mt-1 h-12 w-full text-base shadow-lg shadow-brand-600/25">
              {signingIn ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-slate-500">Forgot your password? Ask the owner to reset it.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
