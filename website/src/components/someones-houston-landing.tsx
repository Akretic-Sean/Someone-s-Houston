import { useEffect, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Dumbbell,
  ExternalLink,
  HeartPulse,
  House,
  Menu,
  Plane,
  Route,
  ShieldCheck,
  Sparkles,
  Utensils,
  Waves,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import posterAsset from "@/assets/houston-poster.jpg.asset.json";
import downtownHoustonAsset from "@/assets/downtown-houston.jpg.asset.json";
import hackathonAsset from "@/assets/houston-hackathon.jpg.asset.json";
import pinLogo from "@/assets/someones-houston-pin.png.asset.json";
import mapAsset from "@/assets/houston-map.png.asset.json";

const videoUrl =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4";

/**
 * Where "Create a Candidate Report" sends recruiters — the login screen of the
 * report web app (frontend/report-web in the Someone-s-Houston repo).
 * TODO: replace with the deployed app URL once the app is hosted.
 */
const REPORT_APP_URL = "http://localhost:5173";

const navItems = [
  ["How It Works", "#how-it-works"],
  ["For Recruiters", "#recruiters"],
  ["The Houston Advantage", "#houston-advantage"],
  ["Data & Trust", "#data-trust"],
] as const;

const neighborhoods = [
  {
    name: "Midtown",
    match: "94% match",
    commute: "6 min",
    affordability: "Strong",
    flood: "Review by address",
    note: "Close to the Ion and Houston’s startup district",
  },
  {
    name: "Montrose",
    match: "89% match",
    commute: "11 min",
    affordability: "Good",
    flood: "Varies by block",
    note: "Strong restaurant and fitness access",
  },
  {
    name: "The Heights",
    match: "84% match",
    commute: "17 min",
    affordability: "Balanced",
    flood: "Review by address",
    note: "Aligned with weekend sports and airport travel preferences",
  },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a href="#top" className="group inline-flex items-center gap-2.5" aria-label="Someone’s Houston home">
      <img
        src={pinLogo.url}
        alt=""
        className="size-9 rounded-full object-cover shadow-[var(--shadow-orange)] transition-transform group-hover:rotate-6"
      />
      <span className={compact ? "font-display text-xl" : "font-display text-2xl"}>Someone’s Houston</span>
    </a>
  );
}

function Navigation() {
  return (
    <header className="absolute inset-x-0 top-0 z-40 px-4 pt-5 sm:px-6 lg:px-8">
      <nav className="liquid-glass mx-auto flex h-16 max-w-7xl items-center justify-between rounded-full px-4 text-deep-foreground sm:px-5" aria-label="Main navigation">
        <Brand compact />
        <div className="hidden items-center gap-6 lg:flex">
          {navItems.map(([label, href]) => (
            <a key={href} href={href} className="text-sm font-medium text-white transition-opacity hover:opacity-80">
              {label}
            </a>
          ))}
        </div>
        <div className="hidden lg:block">
          <Button asChild className="h-10 rounded-full bg-brand-orange px-5 text-brand-orange-foreground hover:bg-brand-orange/90">
            <a href={REPORT_APP_URL}>Create a Candidate Report</a>
          </Button>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full text-foreground hover:bg-foreground/10 hover:text-foreground lg:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent className="border-border bg-background text-foreground">
            <SheetHeader className="text-left">
              <SheetTitle><Brand compact /></SheetTitle>
              <SheetDescription>Houston relocation intelligence for every candidate conversation.</SheetDescription>
            </SheetHeader>
            <div className="mt-10 flex flex-col gap-1">
              {navItems.map(([label, href]) => (
                <SheetClose asChild key={href}>
                  <a href={href} className="flex items-center justify-between border-b border-border py-4 text-lg">
                    {label}<ChevronRight className="size-4 text-muted-foreground" />
                  </a>
                </SheetClose>
              ))}
            </div>
            <SheetClose asChild>
              <Button asChild className="mt-8 h-12 w-full rounded-full bg-brand-orange text-brand-orange-foreground hover:bg-brand-orange/90">
                <a href={REPORT_APP_URL}>Create a Candidate Report</a>
              </Button>
            </SheetClose>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative flex min-h-[92svh] items-center overflow-hidden text-deep-foreground">
      <video
        className="hero-video absolute inset-0 z-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        poster={posterAsset.url}
        aria-hidden="true"
      >
        <source src={videoUrl} type="video/mp4" />
      </video>
      <img className="hero-poster absolute inset-0 z-0 h-full w-full object-cover" src={posterAsset.url} alt="" />
      <div className="absolute inset-0 z-10 bg-hero-overlay" />
      <Navigation />
      <div className="relative z-20 mx-auto w-full max-w-6xl px-5 pb-10 pt-28 text-center sm:px-8">
        <p className="fade-rise delay-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white sm:text-xs">
          Personalized Houston relocation intelligence
        </p>
        <h1 className="fade-rise delay-2 mx-auto mt-7 max-w-5xl font-display text-5xl leading-[0.98] sm:text-7xl lg:text-[6.25rem]">
          A Houston offer is<br className="hidden sm:block" /> <em className="font-normal text-brand-orange">more than a salary.</em>
        </h1>
        <p className="fade-rise delay-3 mx-auto mt-7 max-w-2xl text-base leading-7 text-white sm:text-lg">
          Someone’s Houston turns a candidate conversation into a transparent relocation report—connecting compensation, neighborhoods, lifestyle preferences, and Houston’s real-world context in one shareable experience.
        </p>
        <div className="fade-rise delay-4 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 w-full rounded-full bg-brand-orange px-7 text-white hover:bg-brand-orange/90 sm:w-auto">
            <a href="#sample-report">See a Sample Report <ArrowRight /></a>
          </Button>
          <Button asChild size="lg" variant="outline" className="liquid-glass h-12 w-full rounded-full border-white/20 bg-white/5 px-7 text-white hover:bg-white/10 hover:text-white sm:w-auto">
            <a href="#recruiters"><span className="inline-flex items-center">Built for&nbsp;<RotatingRole min="9ch" /></span></a>
          </Button>
        </div>
        <p className="fade-rise delay-5 mt-7 text-xs text-white/90 sm:text-sm">
          Personalized preferences. Transparent assumptions. Houston data at the center.
        </p>
      </div>
      <a href="#sample-report" aria-label="Explore the sample report" className="absolute bottom-6 left-1/2 z-20 hidden -translate-x-1/2 flex-col items-center gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-foreground/45 lg:flex">
        Explore<span className="h-8 w-px bg-foreground/30" />
      </a>
    </section>
  );
}

function FinancialView() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
      <div className="rounded-lg border border-report-border bg-report-panel p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="report-label">Offer comparison</p><h3 className="mt-2 font-display text-3xl">Your dollars, in context.</h3></div>
          <CircleDollarSign className="size-6 text-match" />
        </div>
        <div className="mt-8 space-y-7">
          <ComparisonBar city="San Francisco" value="$185k" width="58%" muted />
          <ComparisonBar city="Houston" value="$185k" width="88%" />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 border-t border-report-border pt-5">
          <div><p className="report-label">Estimated take-home</p><p className="mt-2 text-lg font-semibold">Higher in Houston</p></div>
          <div><p className="report-label">Purchasing power</p><p className="mt-2 text-lg font-semibold text-match">Meaningfully stronger</p></div>
        </div>
        <p className="mt-5 text-xs leading-5 text-report-muted">Illustrative comparison only. Assumptions are visible and editable in a full report.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <Insight icon={BriefcaseBusiness} label="Career" title="The Ion puts you near a growing innovation network." />
        <Insight icon={House} label="Housing" title="More options appear within your target monthly range." />
        <Insight icon={Route} label="Commute" title="Three suggested neighborhoods stay under 20 minutes." />
      </div>
    </div>
  );
}

function ComparisonBar({ city, value, width, muted = false }: { city: string; value: string; width: "58%" | "88%"; muted?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between"><span className="text-sm font-medium">{city}</span><span className="font-display text-2xl">{value}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-report-track"><div className={`${muted ? "bg-report-muted" : "bg-match"} h-full rounded-full ${width === "58%" ? "w-[58%]" : "w-[88%]"}`} /></div>
    </div>
  );
}

function Insight({ icon: Icon, label, title }: { icon: typeof BriefcaseBusiness; label: string; title: string }) {
  return (
    <div className="rounded-lg border border-report-border bg-report-panel p-5">
      <div className="flex items-center gap-2 text-match"><Icon className="size-4" /><span className="report-label text-match">{label}</span></div>
      <p className="mt-3 text-sm leading-6 text-report-foreground">{title}</p>
    </div>
  );
}

function NeighborhoodsView() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {neighborhoods.map((place) => (
        <article key={place.name} className="rounded-lg border border-report-border bg-report-panel p-5 transition-transform hover:-translate-y-1">
          <div className="flex items-center justify-between gap-3"><h3 className="font-display text-2xl">{place.name}</h3><span className="rounded-full bg-match-soft px-2.5 py-1 text-xs font-semibold text-match">{place.match}</span></div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="flex items-center gap-2 text-report-muted"><Clock3 className="size-3.5" /> Commute</dt><dd>{place.commute}</dd></div>
            <div className="flex justify-between gap-3"><dt className="flex items-center gap-2 text-report-muted"><CircleDollarSign className="size-3.5" /> Affordability</dt><dd>{place.affordability}</dd></div>
            <div className="flex justify-between gap-3"><dt className="flex items-center gap-2 text-report-muted"><Waves className="size-3.5" /> Flood context</dt><dd className="text-right text-caution">{place.flood}</dd></div>
          </dl>
          <div className="mt-5 border-t border-report-border pt-4"><p className="report-label">Why it fits</p><p className="mt-2 text-sm leading-5 text-report-foreground">{place.note}</p></div>
        </article>
      ))}
    </div>
  );
}

function LifestyleView() {
  const items = [
    [Utensils, "Food & groceries", "Independent restaurants, H-E-B access, and global cuisine scored highly."],
    [Dumbbell, "Fitness & outdoors", "Studios, trails, and weekend recreation shape the neighborhood shortlist."],
    [Plane, "Travel", "Access to Hobby and IAH is balanced against the weekday commute."],
  ] as const;
  return <div className="grid gap-3 lg:grid-cols-3">{items.map(([Icon, title, copy]) => <Insight key={title} icon={Icon} label="Strong preference match" title={`${title}: ${copy}`} />)}</div>;
}

function CareerView() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <div className="rounded-lg border border-report-border bg-report-panel p-6">
        <p className="report-label">Career ecosystem</p><h3 className="mt-2 font-display text-3xl">A role connected to more than one industry.</h3>
        <p className="mt-4 max-w-xl text-sm leading-6 text-report-muted">The Ion sits at the center of Houston’s innovation district, with proximity to founders, universities, energy transition teams, and healthcare technology.</p>
      </div>
      <div className="rounded-lg border border-report-border bg-report-panel p-6">
        <p className="report-label">Relevant signals</p>
        <ul className="mt-4 space-y-3 text-sm">{["ML role aligned with growth priorities", "Cross-industry mobility", "Central office location"].map((item) => <li key={item} className="flex items-center gap-3"><span className="grid size-5 place-items-center rounded-full bg-match-soft text-match"><Check className="size-3" /></span>{item}</li>)}</ul>
      </div>
    </div>
  );
}

function ReportPreview() {
  return (
    <section id="sample-report" className="section-shell paper-texture relative -mt-px py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mb-12 grid items-end gap-8 lg:grid-cols-[.8fr_1.2fr]">
          <div className="pb-2"><p className="eyebrow">A report built around the person</p><h2 className="mt-4 max-w-2xl font-display text-4xl leading-tight sm:text-6xl">See the opportunity—and the city—through their eyes.</h2><p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">Not a generic city guide. A focused decision tool shaped by the offer, the office, and what a candidate values.</p></div>
          <figure className="overflow-hidden rounded-lg bg-section">
            <img src={downtownHoustonAsset.url} alt="Downtown Houston skyline viewed from a landscaped urban park" className="aspect-[4/3] w-full object-cover sm:aspect-[16/9]" />
            <figcaption className="flex items-center justify-between gap-4 px-4 py-3 text-xs text-muted-foreground"><span>Downtown Houston</span><span>Opportunity, placed in context</span></figcaption>
          </figure>
        </div>
        <div className="report-shell overflow-hidden rounded-lg border border-report-border bg-report text-report-foreground shadow-[var(--shadow-report)]">
          <div className="flex flex-col justify-between gap-5 border-b border-report-border p-5 sm:p-7 md:flex-row md:items-center">
            <div><div className="flex items-center gap-2 text-match"><Sparkles className="size-4" /><span className="report-label text-match">Someone’s Houston Report</span></div><h3 className="mt-2 font-display text-3xl text-report-foreground sm:text-4xl">Senior ML Engineer</h3></div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:flex sm:gap-8">
              <div><span className="report-label block">Moving from</span><span className="mt-1 block text-report-foreground">San Francisco</span></div>
              <div><span className="report-label block">Houston offer</span><span className="mt-1 block text-report-foreground">$185,000</span></div>
              <div><span className="report-label block">Office</span><span className="mt-1 block text-report-foreground">The Ion, Midtown</span></div>
            </div>
          </div>
          <Tabs defaultValue="money" className="p-4 sm:p-7">
            <TabsList className="mb-5 grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-report-track p-1 sm:grid-cols-4">
              {([['career', 'Career'], ['money', 'Money'], ['neighborhoods', 'Neighborhoods'], ['lifestyle', 'Lifestyle']] as const).map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-10 rounded-md text-report-muted data-[state=active]:bg-report-panel data-[state=active]:text-report-foreground">{label}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="career"><CareerView /></TabsContent>
            <TabsContent value="money"><FinancialView /></TabsContent>
            <TabsContent value="neighborhoods"><NeighborhoodsView /></TabsContent>
            <TabsContent value="lifestyle"><LifestyleView /></TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["01", "Import the conversation", "Recruiters upload interview notes or bring in a candidate conversation."],
    ["02", "Capture what matters", "Someone’s Houston suggests editable priorities—from commute and groceries to sports, travel, and healthcare."],
    ["03", "Share their Houston", "Candidates receive a polished report to review and share with a partner or family."],
  ];
  return (
    <section id="how-it-works" className="paper-texture border-y border-border py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <p className="eyebrow">From conversation to clarity</p><h2 className="mt-4 font-display text-4xl sm:text-6xl">A better relocation story, in three steps.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-3">
          {steps.map(([number,title,copy], index) => <article key={number} className="relative bg-section p-7 sm:p-9"><span className="font-display text-4xl text-brand-orange">{number}</span><h3 className="mt-8 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>{index < 2 && <ArrowRight className="absolute -right-3 top-10 z-10 hidden size-6 rounded-full bg-brand-orange p-1 text-brand-orange-foreground lg:block" />}{index === 0 && <div className="mt-7"><p className="mb-3 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">Connectors coming soon</p><div className="flex flex-wrap gap-2">{["Granola","Fireflies","Fathom","Zoom Notes"].map(x => <span key={x} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs">{x}</span>)}</div></div>}</article>)}
        </div>
      </div>
    </section>
  );
}

function HoustonAdvantage() {
  const features = [
    [Building2, "Career ecosystems", "Technology intersects with energy, healthcare, aerospace, and industrial innovation."],
    [Plane, "Two-airport access", "IAH and Hobby connect Houston to the cities, teams, events, and weekend destinations candidates care about."],
    [HeartPulse, "Healthcare access", "The Texas Medical Center is a major consideration for candidates and families with healthcare needs."],
    [Utensils, "Lifestyle, personalized", "Food, sports, fitness, grocery options, recreation, and neighborhoods should fit the person—not just the offer."],
  ] as const;
  return (
    <section id="houston-advantage" className="paper-texture py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:gap-20"><div><p className="eyebrow">The Houston advantage</p><h2 className="mt-4 font-display text-5xl leading-[1.02] sm:text-7xl">Houston is not one story.</h2></div><p className="self-end text-base leading-7 text-muted-foreground sm:text-lg">From the innovation district at The Ion to the Texas Medical Center, Energy Corridor, Downtown, and NASA’s Clear Lake ecosystem, Someone’s Houston helps candidates connect the opportunity in front of them with the life they want to build.</p></div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">{features.map(([Icon,title,copy]) => <article key={title} className="group bg-background p-7 transition-colors hover:bg-section sm:p-9"><Icon className="size-6 text-brand-orange transition-transform group-hover:scale-110" /><h3 className="mt-12 font-display text-3xl">{title}</h3><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{copy}</p></article>)}</div>
      </div>
    </section>
  );
}

function TechCommunity() {
  return (
    <section id="tech-community" className="paper-texture py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:gap-20">
        <figure className="overflow-hidden rounded-lg bg-background shadow-[var(--shadow-report)]">
          <img src={hackathonAsset.url} alt="Houston developers collaborating around tables at a local hackathon" className="aspect-[4/3] w-full object-cover" />
          <figcaption className="px-4 py-3 text-xs text-muted-foreground">Builders collaborating at a Houston tech event</figcaption>
        </figure>
        <div>
          <p className="eyebrow">Tech community</p>
          <h2 className="mt-4 font-display text-5xl leading-[1.02] sm:text-7xl">A city built by people who show up.</h2>
          <p className="mt-6 text-base leading-7 text-muted-foreground sm:text-lg">Houston’s developer ecosystem comes alive in hackathons, meetups, founder networks, and working sessions across The Ion and the city’s innovation hubs.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {["Hackathons that turn ideas into teams", "Meetups across engineering, AI, and product", "Builder networks rooted in real industries"].map((item) => <div key={item} className="flex items-center gap-3 border-t border-border pt-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-match-soft text-match"><Check className="size-3.5" /></span>{item}</div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  const principles = [
    [Database, "No black-box recommendations", "Candidates can see why a neighborhood was suggested and which preferences influenced it."],
    [Waves, "Flood context, not false certainty", "Available local context is surfaced without pretending to predict property-level risk."],
    [CircleDollarSign, "Honest cost comparison", "Take-home pay, housing assumptions, and property-tax context belong in the same view."],
    [ShieldCheck, "Candidate consent first", "Candidate contact information is only shared through an explicit opt-in."],
  ] as const;
  return (
    <section id="data-trust" className="bg-deep py-20 text-deep-foreground sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:gap-20"><div><p className="eyebrow text-brand-orange">Data, context, and trust</p><h2 className="mt-4 font-display text-5xl leading-[1.04] sm:text-7xl">The pitch is stronger when the tradeoffs are visible.</h2><p className="mt-7 max-w-lg text-base leading-7 text-deep-muted">Houston has real advantages—and real considerations. Someone’s Houston earns trust by showing both.</p></div><div className="divide-y divide-deep-border border-y border-deep-border">{principles.map(([Icon,title,copy]) => <article key={title} className="grid grid-cols-[auto_1fr] gap-5 py-6"><span className="grid size-10 place-items-center rounded-full border border-deep-border text-caution"><Icon className="size-4" /></span><div><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-deep-muted">{copy}</p></div></article>)}</div></div><div className="mt-14 flex items-start gap-3 border-t border-deep-border pt-6 text-xs leading-5 text-deep-muted"><ExternalLink className="mt-0.5 size-4 shrink-0" /><p>Designed to incorporate City of Houston Open Data, Census data, and transparent reference sources. Estimates are for comparison only.</p></div></div>
    </section>
  );
}

function RotatingRole({ min = "11ch" }: { min?: string }) {
  const roles = ["Recruiters", "Relocation Specialists"];
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(roles[0]);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % roles.length);
    }, 2800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setShown(roles[index]);
  }, [index]);

  return (
    <span className="relative inline-flex justify-center align-bottom" style={{ minWidth: min }}>
      <span
        key={shown}
        className="animate-role-swap inline-block"
        style={{ animation: "role-swap 0.5s cubic-bezier(.22,.8,.25,1)" }}
      >
        {shown}
      </span>
    </span>
  );
}

function RecruiterCta() {
  return (
    <section id="recruiters" className="bg-brand-orange py-20 text-brand-orange-foreground sm:py-28"><div className="mx-auto max-w-5xl px-5 text-center sm:px-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Built for the people making the introduction</p><h2 className="mt-5 font-display text-5xl leading-none sm:text-7xl">Make Houston easier to say yes to.</h2><p className="mx-auto mt-6 max-w-2xl text-base leading-7 opacity-80 sm:text-lg">Give candidates a personalized relocation story grounded in the things they actually care about—not a generic cost-of-living pitch.</p><Button asChild className="mt-9 h-12 rounded-full bg-deep px-7 text-deep-foreground hover:bg-deep/90"><a href={REPORT_APP_URL}>Create a Candidate Report <ArrowRight /></a></Button><p className="mt-6 text-xs opacity-65">Built for Houston <RotatingRole />, hiring leaders, and economic-development partners.</p></div></section>
  );
}

function Footer() {
  return (
    <footer className="paper-texture relative overflow-hidden py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-[0.06]"
        style={{ backgroundImage: `url(${mapAsset.url})` }}
      />
      <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8">
        <div className="flex flex-col justify-between gap-8 border-b border-border pb-10 md:flex-row">
          <Brand />
          <nav className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <a href="#sample-report" className="hover:text-foreground">Product</a>
            <a href="#recruiters" className="hover:text-foreground">Recruiters</a>
            <a href="#tech-community" className="hover:text-foreground">Tech Community</a>
            <a href="#data-trust" className="hover:text-foreground">Data & Trust</a>
            <a href="mailto:hello@someoneshouston.com" className="hover:text-foreground">Contact</a>
          </nav>
        </div>
        <div className="mt-7 grid gap-4 text-xs leading-5 text-muted-foreground md:grid-cols-2">
          <p>Someone’s Houston provides estimates for comparison and is not tax, financial, real-estate, or medical advice.</p>
          <p className="md:text-right">Open-data attribution: City of Houston Open Data and U.S. Census reference sources.</p>
        </div>
      </div>
    </footer>
  );
}

export function SomeonesHoustonLanding() {
  return (
    <main>
      <Hero />
      <ReportPreview />
      <HowItWorks />
      <HoustonAdvantage />
      <TechCommunity />
      <TrustSection />
      <RecruiterCta />
      <Footer />
    </main>
  );
}