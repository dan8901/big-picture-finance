import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Big Picture Finance",
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
