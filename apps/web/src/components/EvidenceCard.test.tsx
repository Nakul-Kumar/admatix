import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceCard } from "./EvidenceCard.js";
import { agencyDemoAudit } from "../lib/fixtures-fallback.js";

describe("EvidenceCard — acceptance test #3", () => {
  it("renders a finding with clickable source refs", () => {
    const finding = agencyDemoAudit.findings[0]!;
    render(<EvidenceCard finding={finding} />);
    expect(screen.getByText(finding.title)).toBeInTheDocument();
    const links = screen.getAllByTestId("evidence-ref-link");
    expect(links.length).toBe(finding.evidence.length);
    for (const link of links) {
      expect(link).toHaveAttribute("href");
      expect((link as HTMLAnchorElement).href).toMatch(/\/packets\?source=/);
    }
  });
});
