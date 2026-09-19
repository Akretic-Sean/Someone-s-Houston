import { createFileRoute } from "@tanstack/react-router";
import { SomeonesHoustonLanding } from "@/components/someones-houston-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Someone’s Houston | Houston Relocation Intelligence" },
      { name: "description", content: "Personalized Houston relocation reports for technology candidates, built around compensation, neighborhoods, lifestyle, and transparent local context." },
      { property: "og:title", content: "Someone’s Houston | Houston Relocation Intelligence" },
      { property: "og:description", content: "Turn a candidate conversation into a transparent, personalized Houston relocation report." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <SomeonesHoustonLanding />;
}
