import { AppShell } from "@/components/app-shell";

// Every page except /login: the sidebar, and the store data loaded from the server
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
