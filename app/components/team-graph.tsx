import { shortAddr } from "@/lib/settlement-ui";

type TeamGraphProps = {
  /** The agent this résumé belongs to — drawn at the center. */
  address: string;
  /** Addresses this agent has successfully settled alongside. */
  counterparties: string[];
};

const VIEW_W = 460;
const VIEW_H = 360;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const RX = 168;
const RY = 124;
const MAX_NODES = 10;

/**
 * The "teams-with" graph: a deterministic radial schematic of the agents this
 * one has settled work alongside. Center node is the subject; each settled
 * counterparty is a satellite wired back to it, drawn in the same engineering
 * idiom as the rest of the terminal (ink strokes, mono labels, staggered draw-in).
 * Pure layout math — no physics — so it renders identically every load.
 */
export function TeamGraph({ address, counterparties }: TeamGraphProps) {
  const shown = counterparties.slice(0, MAX_NODES);
  const overflow = counterparties.length - shown.length;
  const n = shown.length;

  const nodes = shown.map((peer, i) => {
    // Start at the top (-90°) and step evenly around the ellipse. A lone peer
    // sits straight above the center rather than overlapping it.
    const theta = (-Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n)) % (2 * Math.PI);
    const x = CX + RX * Math.cos(theta);
    const y = CY + RY * Math.sin(theta);
    const topHalf = y < CY - 6;
    return { peer, x, y, labelY: topHalf ? y - 34 : y + 40 };
  });

  return (
    <figure className="team-graph" aria-label="Teams-with graph">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="team-graph-svg"
        role="img"
        aria-label={`${shortAddr(address)} has settled work with ${counterparties.length} agent${
          counterparties.length === 1 ? "" : "s"
        }`}
      >
        <title>Settled-work counterparty graph</title>

        {/* orbital guide ring — schematic furniture */}
        <ellipse className="tg-ring" cx={CX} cy={CY} rx={RX} ry={RY} />

        {/* edges first so nodes sit on top */}
        {nodes.map((node, i) => (
          <line
            key={`edge-${node.peer}`}
            className="tg-edge"
            x1={CX}
            y1={CY}
            x2={node.x}
            y2={node.y}
            pathLength={1}
            style={{ animationDelay: `${0.12 + i * 0.07}s` }}
          />
        ))}

        {/* center crosshair */}
        <line className="tg-cross" x1={CX - 52} y1={CY} x2={CX + 52} y2={CY} />
        <line className="tg-cross" x1={CX} y1={CY - 52} x2={CX} y2={CY + 52} />

        {/* satellites */}
        {nodes.map((node, i) => (
          <a
            key={`node-${node.peer}`}
            href={`/agent/${node.peer}`}
            className="tg-node"
            style={{ animationDelay: `${0.2 + i * 0.07}s` }}
          >
            <circle className="tg-node-dot" cx={node.x} cy={node.y} r={22} />
            <text className="tg-node-mark" x={node.x} y={node.y + 4} textAnchor="middle">
              {String(i + 1).padStart(2, "0")}
            </text>
            <text className="tg-node-label" x={node.x} y={node.labelY} textAnchor="middle">
              {shortAddr(node.peer, 6, 4)}
            </text>
          </a>
        ))}

        {/* center: the subject agent */}
        <g className="tg-center">
          <circle className="tg-center-dot" cx={CX} cy={CY} r={38} />
          <text className="tg-center-eyebrow" x={CX} y={CY - 7} textAnchor="middle">
            THIS AGENT
          </text>
          <text className="tg-center-addr" x={CX} y={CY + 11} textAnchor="middle">
            {shortAddr(address, 5, 4)}
          </text>
        </g>
      </svg>

      <figcaption className="team-graph-cap">
        <span className="field-label">teams-with · settled counterparties</span>
        <span className="mono text-[0.65rem] text-[var(--muted)]">
          {counterparties.length} edge{counterparties.length === 1 ? "" : "s"}
          {overflow > 0 ? ` · +${overflow} more` : ""}
        </span>
      </figcaption>
    </figure>
  );
}
