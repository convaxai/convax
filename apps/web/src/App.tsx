import { useState, type ReactNode } from "react"
import {
  ArrowRight,
  Bot,
  Box,
  ChevronRight,
  Check,
  Code,
  Download,
  FileImage,
  FileText,
  Film,
  Folder,
  Grid3X3,
  Layers3,
  Menu,
  MessageSquare,
  MousePointer2,
  Play,
  Plus,
  Search,
  Sparkles,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react"
import {
  downloadUrl,
  githubUrl,
  navItems,
  plans,
  plugins,
  useCases,
  valuePillars,
  workflowChapters,
} from "./landing-content"

function LogoMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <svg aria-hidden="true" className="logo-mark" fill="none" viewBox="0 0 100 100">
      <rect className="logo-mark__tile" height="84" rx="19" width="84" x="8" y="8" />
      <path className="logo-mark__outer" d="M68.5 27.5A31 31 0 1 0 68.5 72.5" strokeLinecap="round" strokeWidth="8" />
      <path className="logo-mark__inner" d="M65 39A18.5 18.5 0 1 0 65 61" strokeLinecap="round" strokeWidth="5" />
      <circle className="logo-mark__accent" cx="72" cy="27.5" r="4.2" />
      {inverted ? <title>Convax</title> : null}
    </svg>
  )
}

function Brand({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className={`brand${inverted ? " brand--inverted" : ""}`}>
      <LogoMark inverted={inverted} />
      <span>
        conva<span>x</span>
      </span>
    </span>
  )
}

function ArrowLink({ children, className = "", href }: { children: ReactNode; className?: string; href: string }) {
  return (
    <a className={`arrow-link ${className}`} href={href}>
      <span>{children}</span>
      <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
    </a>
  )
}

function ProductPreview() {
  return (
    <div aria-hidden="true" className="product-window">
      <div className="product-window__bar">
        <div aria-hidden="true" className="window-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="window-title">
          <LogoMark />
          <span>campaign-film</span>
        </div>
        <div className="window-actions">
          <Search size={13} />
          <span>⌘ K</span>
        </div>
      </div>

      <div className="product-window__body">
        <aside className="project-panel">
          <div className="panel-heading">
            <span>Project</span>
            <Plus size={13} />
          </div>
          <div className="project-switcher">
            <span className="project-avatar">CF</span>
            <span>
              <b>Campaign film</b>
              <small>Local project</small>
            </span>
            <ChevronRight size={13} />
          </div>

          <div className="panel-section">
            <div className="panel-label">
              <span>Canvases</span>
              <span>3</span>
            </div>
            <button className="panel-row panel-row--active" tabIndex={-1} type="button">
              <Grid3X3 size={13} />
              Direction board
            </button>
            <button className="panel-row" tabIndex={-1} type="button">
              <Layers3 size={13} />
              Shot planning
            </button>
          </div>

          <div className="panel-section">
            <div className="panel-label">
              <span>Files</span>
              <Plus size={12} />
            </div>
            <button className="panel-row" tabIndex={-1} type="button">
              <Folder size={13} />
              References
            </button>
            <button className="panel-row" tabIndex={-1} type="button">
              <FileText size={13} />
              creative-brief.md
            </button>
            <button className="panel-row" tabIndex={-1} type="button">
              <FileImage size={13} />
              product-still.png
            </button>
          </div>

          <div className="project-panel__footer">
            <span className="status-dot" />
            Project saved
          </div>
        </aside>

        <div className="canvas-stage">
          <div className="canvas-toolbar">
            <button aria-label="Select" className="is-active" tabIndex={-1} type="button">
              <MousePointer2 size={13} />
            </button>
            <button aria-label="Add card" tabIndex={-1} type="button">
              <Plus size={13} />
            </button>
            <span />
            <button aria-label="Generate" tabIndex={-1} type="button">
              <Sparkles size={13} />
            </button>
          </div>

          <svg aria-hidden="true" className="canvas-connections" viewBox="0 0 700 470">
            <defs>
              <linearGradient id="line-lime" x1="0" x2="1">
                <stop offset="0" stopColor="#c6f22d" stopOpacity=".22" />
                <stop offset=".5" stopColor="#c6f22d" stopOpacity=".9" />
                <stop offset="1" stopColor="#c6f22d" stopOpacity=".28" />
              </linearGradient>
            </defs>
            <path d="M238 117C310 117 280 230 356 230" />
            <path d="M226 315C300 315 280 254 356 254" />
            <path className="canvas-connection--active" d="M518 241C580 241 574 332 638 332" />
          </svg>

          <article className="canvas-node canvas-node--brief">
            <div className="node-kicker">
              <FileText size={11} />
              Creative brief
            </div>
            <h3>Quiet energy, built for motion.</h3>
            <p>Focus on material, pace, and a sense of discovery.</p>
            <span className="node-port node-port--out" />
          </article>

          <article className="canvas-node canvas-node--reference">
            <div className="node-image">
              <span />
              <span />
              <span />
            </div>
            <div className="node-caption">
              <FileImage size={11} />
              Visual reference
            </div>
            <span className="node-port node-port--out" />
          </article>

          <article className="canvas-node canvas-node--direction">
            <span className="node-port node-port--in" />
            <div className="node-kicker node-kicker--lime">
              <WandSparkles size={11} />
              Direction
            </div>
            <h3>Soft industrial</h3>
            <div className="direction-swatches">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="node-chip">Ready for generation</div>
            <span className="node-port node-port--out" />
          </article>

          <article className="canvas-node canvas-node--video">
            <span className="node-port node-port--in" />
            <div className="video-frame">
              <Play fill="currentColor" size={14} />
            </div>
            <div className="node-caption">
              <Film size={11} />
              Motion study · 00:12
            </div>
          </article>

          <div className="canvas-zoom">64%</div>
        </div>

        <aside className="agent-panel">
          <div className="agent-panel__header">
            <span>
              <Bot size={14} />
              Agent
            </span>
            <span className="agent-status">Ready</span>
          </div>
          <div className="agent-context">
            <span>Context</span>
            <div>
              <span>
                <Grid3X3 size={11} />
                Direction board
              </span>
              <span>
                <FileText size={11} />
                creative-brief.md
              </span>
            </div>
          </div>
          <div className="agent-thread">
            <div className="agent-message agent-message--user">
              Turn these references into three visual directions. Keep the product geometry intact.
            </div>
            <div className="agent-run">
              <span>
                <Sparkles size={12} />
                Reading connected context
              </span>
              <span className="run-check">✓</span>
            </div>
            <div className="agent-run">
              <span>
                <Workflow size={12} />
                Creating direction cards
              </span>
              <span className="run-pulse" />
            </div>
            <div className="agent-message">
              I have added three directions beside the references and kept the material constraints attached.
            </div>
          </div>
          <div className="agent-composer">
            <span>Ask about this canvas…</span>
            <button aria-label="Send message" tabIndex={-1} type="button">
              <ArrowRight size={13} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function StoryVisual({ type }: { type: (typeof workflowChapters)[number]["visual"] }) {
  if (type === "project") {
    return (
      <div className="story-visual story-visual--project">
        <div className="story-file-list">
          <div className="story-list-header">
            <span>Campaign film</span>
            <span>12 items</span>
          </div>
          <div>
            <Folder size={16} />
            <span>References</span>
            <small>8 files</small>
          </div>
          <div className="story-list-row--selected">
            <FileText size={16} />
            <span>creative-brief.md</span>
            <small>12 KB</small>
          </div>
          <div>
            <FileImage size={16} />
            <span>product-still.png</span>
            <small>4.2 MB</small>
          </div>
          <div>
            <Film size={16} />
            <span>motion-test.mov</span>
            <small>38 MB</small>
          </div>
        </div>
        <div className="story-drag-card">
          <FileText size={17} />
          <span>
            <b>creative-brief.md</b>
            <small>Drop on Canvas</small>
          </span>
        </div>
        <div className="story-canvas-target">
          <Plus size={18} />
          <span>Project file</span>
        </div>
      </div>
    )
  }

  if (type === "canvas") {
    return (
      <div className="story-visual story-visual--canvas">
        <svg aria-hidden="true" viewBox="0 0 560 340">
          <path d="M142 91C220 91 200 166 276 166" />
          <path d="M140 266C218 266 202 190 276 190" />
          <path className="active" d="M382 178C445 178 435 242 500 242" />
        </svg>
        <div className="mini-node mini-node--copy">
          <span>BRIEF</span>
          <b>Built for motion</b>
          <small>Quiet confidence, precise detail.</small>
        </div>
        <div className="mini-node mini-node--image">
          <div />
          <span>REFERENCE</span>
        </div>
        <div className="mini-node mini-node--middle">
          <Sparkles size={15} />
          <b>Direction</b>
          <small>Soft industrial</small>
        </div>
        <div className="mini-node mini-node--result">
          <Play fill="currentColor" size={17} />
          <span>RESULT</span>
        </div>
      </div>
    )
  }

  if (type === "agent") {
    return (
      <div className="story-visual story-visual--agent">
        <div className="story-agent-context">
          <span className="context-label">Attached context</span>
          <span>
            <Grid3X3 size={13} />
            Direction board
          </span>
          <span>
            <FileImage size={13} />3 selected nodes
          </span>
        </div>
        <div className="story-agent-chat">
          <div className="chat-user">Group the strongest references and make the relationship clear.</div>
          <div className="chat-step">
            <span>
              <Sparkles size={13} />
              Inspecting the active Canvas
            </span>
            <b>Done</b>
          </div>
          <div className="chat-step">
            <span>
              <Workflow size={13} />
              Updating 4 relationships
            </span>
            <i />
          </div>
          <div className="chat-agent">
            The references are grouped by material and motion. I also brought the new structure into view.
          </div>
        </div>
        <div className="story-agent-composer">
          <MessageSquare size={15} />
          <span>Continue working with this context…</span>
          <ArrowRight size={14} />
        </div>
      </div>
    )
  }

  return (
    <div className="story-visual story-visual--plugins">
      <div className="plugin-orbit plugin-orbit--one">
        <div>
          <WandSparkles size={19} />
        </div>
        <span>Convax Account</span>
      </div>
      <div className="plugin-orbit plugin-orbit--two">
        <div>
          <Film size={19} />
        </div>
        <span>ChatCut</span>
      </div>
      <div className="plugin-orbit plugin-orbit--three">
        <div>
          <Workflow size={19} />
        </div>
        <span>FFmpeg</span>
      </div>
      <div className="plugin-orbit plugin-orbit--four">
        <div>
          <Box size={19} />
        </div>
        <span>3D Desk</span>
      </div>
      <div className="plugin-center">
        <LogoMark />
        <b>Convax</b>
        <small>Scoped capabilities</small>
      </div>
    </div>
  )
}

export function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <>
      <header className="site-header">
        <a aria-label="Convax home" className="site-header__brand" href="#top">
          <Brand />
        </a>
        <nav aria-label="Primary navigation" className={mobileMenuOpen ? "site-nav site-nav--open" : "site-nav"}>
          {navItems.map((item) => (
            <a href={item.href} key={item.href} onClick={() => setMobileMenuOpen(false)}>
              {item.label}
            </a>
          ))}
          <a href={githubUrl} rel="noreferrer" target="_blank">
            GitHub
          </a>
        </nav>
        <a className="header-cta" href={downloadUrl} rel="noreferrer" target="_blank">
          Get Convax
          <Download aria-hidden="true" size={14} />
        </a>
        <button
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
          className="menu-button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          type="button"
        >
          {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </header>

      <main id="top">
        <section className="hero">
          <a className="announcement" href="#marketplace">
            <span>New</span>
            <span>Meet the extensible Convax workspace</span>
            <ArrowRight size={14} />
          </a>
          <div className="hero__copy">
            <p className="eyebrow">A visual workspace for human and AI work</p>
            <h1>
              Projects, canvases, and agents.
              <span>Working as one.</span>
            </h1>
            <p className="hero__description">
              Open real project files, arrange ideas on an infinite canvas, and collaborate with an Agent that
              understands the work in front of you.
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href={downloadUrl} rel="noreferrer" target="_blank">
                <Download size={16} />
                Download Convax
              </a>
              <a className="button button--ghost" href={githubUrl} rel="noreferrer" target="_blank">
                <Code size={16} />
                View on GitHub
              </a>
            </div>
            <p className="hero__meta">Desktop app · Local projects · Open source</p>
          </div>
          <div className="hero-glow hero-glow--one" />
          <div className="hero-glow hero-glow--two" />
        </section>

        <section aria-label="Core advantages" className="value-grid">
          {valuePillars.map((pillar) => (
            <article key={pillar.number}>
              <span>{pillar.number}</span>
              <div>
                <h2>{pillar.title}</h2>
                <p>{pillar.description}</p>
              </div>
              <ArrowRight aria-hidden="true" size={17} />
            </article>
          ))}
        </section>

        <section className="product-section" id="product">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">The full working context</p>
            <h2>One surface for the project, the thinking, and the next move.</h2>
          </div>
          <p className="sr-only">
            Convax interface preview showing project files, connected Canvas cards, and an Agent using selected context.
          </p>
          <ProductPreview />
          <div className="product-caption">
            <span>Project files</span>
            <i />
            <span>Infinite Canvas</span>
            <i />
            <span>Agent context</span>
          </div>
        </section>

        <section className="workflow-section" id="workflow">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">A continuous workflow</p>
              <h2>Keep the work visible from first input to final output.</h2>
            </div>
            <p>
              Convax does not hide your process inside a conversation. Files, relationships, Agent actions, and
              specialist tools remain part of an editable project.
            </p>
          </div>

          <div className="story-list">
            {workflowChapters.map((chapter, index) => (
              <article className={`story-row${index % 2 === 1 ? " story-row--reverse" : ""}`} key={chapter.eyebrow}>
                <div className="story-copy">
                  <p className="eyebrow">{chapter.eyebrow}</p>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.description}</p>
                  <span>
                    <span className="status-dot" />
                    {chapter.detail}
                  </span>
                </div>
                <StoryVisual type={chapter.visual} />
              </article>
            ))}
          </div>
        </section>

        <section className="marketplace-section" id="marketplace">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">Skills & Plugins</p>
              <h2>A workspace that grows with the work.</h2>
            </div>
            <div className="marketplace-intro">
              <p>
                Add focused creative surfaces and Agent workflows while keeping every capability scoped to the project
                and task that needs it.
              </p>
              <ArrowLink href={`${githubUrl}/tree/main/packages`}>Explore the platform</ArrowLink>
            </div>
          </div>

          <div className="plugin-grid">
            {plugins.map((plugin, index) => (
              <article className={`plugin-card plugin-card--${plugin.tone}`} key={plugin.name}>
                <div className="plugin-card__top">
                  <div className="plugin-icon">
                    {index === 0 ? (
                      <WandSparkles size={19} />
                    ) : index === 1 ? (
                      <Film size={19} />
                    ) : index === 2 ? (
                      <Workflow size={19} />
                    ) : (
                      <Box size={19} />
                    )}
                  </div>
                  <span>{plugin.type}</span>
                </div>
                <h3>{plugin.name}</h3>
                <p>{plugin.description}</p>
                <span className="plugin-card__action">
                  View capability
                  <ArrowRight size={14} />
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="use-cases-section" id="use-cases">
          <div className="section-heading section-heading--center section-heading--narrow">
            <p className="eyebrow">Shape the workspace around the task</p>
            <h2>Creative work changes shape. Your workspace should too.</h2>
          </div>
          <div className="use-case-grid">
            {useCases.map((useCase, index) => (
              <article key={useCase.title}>
                <span>0{index + 1}</span>
                <div className={`use-case-art use-case-art--${index + 1}`}>
                  <i />
                  <i />
                  <i />
                </div>
                <h3>{useCase.title}</h3>
                <p>{useCase.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing-section" id="pricing">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">Simple monthly plans</p>
              <h2>Choose the AI allowance that fits your work.</h2>
            </div>
            <p>
              Every plan includes OpenRouter-backed AI access. Your AI cost budget resets each month, so you can move
              up as your projects grow.
            </p>
          </div>

          <div className="pricing-grid">
            {plans.map((plan, index) => (
              <article className="pricing-card" data-plan={plan.key} key={plan.key}>
                <div className="pricing-card__heading">
                  <span>0{index + 1}</span>
                  <h3>{plan.name}</h3>
                </div>
                <p className="pricing-card__description">{plan.description}</p>
                <div className={`pricing-card__price${plan.priceCny === null ? " pricing-card__price--free" : ""}`}>
                  {plan.priceCny === null ? (
                    <strong>Free</strong>
                  ) : (
                    <>
                      <span>¥</span>
                      <strong>{plan.priceCny}</strong>
                      <small>/ month</small>
                    </>
                  )}
                </div>
                <div className="pricing-card__budget">
                  <span>AI cost budget</span>
                  <strong>{plan.aiBudgetUsd}</strong>
                  <small>per month</small>
                </div>
                <ul>
                  {plan.details.map((detail) => (
                    <li key={detail}>
                      <Check aria-hidden="true" size={14} strokeWidth={2} />
                      {detail}
                    </li>
                  ))}
                </ul>
                <a className="pricing-card__cta" href={plan.href}>
                  {plan.cta}
                  <ArrowRight aria-hidden="true" size={14} />
                </a>
              </article>
            ))}
          </div>
          <p className="pricing-note">
            Prices are shown in CNY. AI cost budgets are measured from OpenRouter usage and reset monthly. Plans are
            selected and managed in your secure AuthX application account.
          </p>
        </section>

        <section className="final-cta">
          <div className="final-cta__mark">
            <LogoMark inverted />
          </div>
          <p className="eyebrow">Build with the full context</p>
          <h2>Stop losing the work between files, chats, and tools.</h2>
          <p>Bring your next project into a workspace where every step stays connected and editable.</p>
          <div className="hero__actions">
            <a className="button button--light" href={downloadUrl} rel="noreferrer" target="_blank">
              <Download size={16} />
              Download Convax
            </a>
            <a className="button button--outline-light" href={githubUrl} rel="noreferrer" target="_blank">
              <Code size={16} />
              Explore GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__brand">
          <Brand />
          <p>A visual workspace for connected, editable, AI-assisted work.</p>
        </div>
        <div className="site-footer__links">
          <div>
            <b>Product</b>
            <a href="#product">Overview</a>
            <a href="#workflow">Workflow</a>
            <a href="#marketplace">Marketplace</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div>
            <b>Resources</b>
            <a href={`${githubUrl}#readme`} rel="noreferrer" target="_blank">
              Documentation
            </a>
            <a href={githubUrl} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <a href={`${githubUrl}/releases`} rel="noreferrer" target="_blank">
              Releases
            </a>
          </div>
          <div>
            <b>Platform</b>
            <a href={`${githubUrl}/tree/main/packages/marketplace`} rel="noreferrer" target="_blank">
              Marketplace
            </a>
            <a href={`${githubUrl}/tree/main/packages/marketplace-kit`} rel="noreferrer" target="_blank">
              Authoring kit
            </a>
            <a href={`${githubUrl}/issues`} rel="noreferrer" target="_blank">
              Feedback
            </a>
          </div>
        </div>
        <div className="site-footer__bottom">
          <span>© {new Date().getFullYear()} Microvoid</span>
          <span>Built in the open</span>
        </div>
      </footer>
    </>
  )
}
