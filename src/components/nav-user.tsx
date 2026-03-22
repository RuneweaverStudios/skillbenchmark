"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Github, LogOut, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

interface UserInfo {
  readonly avatarUrl: string | null;
  readonly username: string;
}

export function NavUser() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function getUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        setUser({
          avatarUrl: authUser.user_metadata?.avatar_url ?? null,
          username: authUser.user_metadata?.user_name ?? authUser.email ?? "User",
        });
      }
      setLoading(false);
    }

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          avatarUrl: session.user.user_metadata?.avatar_url ?? null,
          username: session.user.user_metadata?.user_name ?? session.user.email ?? "User",
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="size-8 animate-pulse rounded-full bg-zinc-800" />
    );
  }

  if (!user) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">
          <Github className="size-4" />
          <span className="hidden sm:inline">Sign in</span>
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link href="/dashboard" className="flex items-center gap-2 rounded-full transition-opacity hover:opacity-80">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.username}
            className="size-8 rounded-full border border-zinc-700"
          />
        ) : (
          <div className="flex size-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
            <User className="size-4 text-zinc-400" />
          </div>
        )}
        <span className="hidden text-sm font-medium text-zinc-200 sm:inline">
          {user.username}
        </span>
      </Link>
      <form action="/api/auth/signout" method="POST">
        <Button variant="ghost" size="icon-xs" type="submit" title="Sign out">
          <LogOut className="size-3.5 text-zinc-500" />
        </Button>
      </form>
    </div>
  );
}
