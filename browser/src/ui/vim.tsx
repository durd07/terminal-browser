import { useMemo } from "react";
import { Box, Text } from "@zenbu-labs/pixel";
import { helpSections } from "../vim/keymap";
import type { HelpSection } from "../vim/keymap";
import type { VimView } from "../vim/vim";
import { mix } from "./theme";
import type { Theme } from "./theme";
import type { ChromeLayout } from "./types";

const MODE_LABEL: Record<VimView["mode"], string> = {
  normal: "NORMAL",
  insert: "INSERT",
  hints: "HINTS",
};

export function VimIndicator({
  view,
  layout,
  theme,
}: {
  view: VimView;
  layout: ChromeLayout;
  theme: Theme;
}) {
  const rem = layout.rem;
  const tint = view.mode === "insert" ? theme.green : view.mode === "hints" ? theme.yellow : theme.accent;
  return (
    <Box
      style={{
        position: "absolute",
        inset: { bottom: rem * 0.6, right: rem * 0.75 },
        height: rem * 1.6,
        alignItems: "center",
        gap: rem * 0.45,
        padding: { left: rem * 0.7, right: rem * 0.7 },
        background: mix(theme.bg, tint, 0.18),
        cornerRadius: rem * 0.4,
        border: { width: 1, color: mix(theme.bg, tint, 0.45) },
      }}
    >
      <Text
        style={{
          fontSize: rem * 0.72,
          color: tint,
          wrap: false,
          selectable: false,
        }}
      >
        {MODE_LABEL[view.mode]}
      </Text>
      {view.pending && (
        <Text
          style={{ fontSize: rem * 0.72, color: theme.muted, wrap: false, selectable: false }}
        >
          {view.pending}
        </Text>
      )}
    </Box>
  );
}

export function VimHelpCard({
  layout,
  theme,
  onClose,
}: {
  layout: ChromeLayout;
  theme: Theme;
  onClose(): void;
}) {
  const rem = layout.rem;
  const sections = useMemo(() => helpSections(), []);
  const cardW = Math.min(rem * 50, layout.width - rem * 2);
  const columns = balance(sections, cardW > rem * 36 ? 2 : 1);
  return (
    <>
      <Box
        style={{
          position: "absolute",
          inset: { top: 0, left: 0 },
          width: layout.width,
          height: layout.height,
        }}
        onClick={onClose}
      />
      <Box
        style={{
          position: "absolute",
          inset: {
            top: layout.toolbarHeight + rem * 0.8,
            left: (layout.width - cardW) / 2,
          },
          width: cardW,
          maxHeight: layout.height - layout.toolbarHeight - rem * 1.6,
          flexDirection: "column",
          gap: rem * 0.5,
          padding: { left: rem, right: rem, top: rem * 0.8, bottom: rem * 0.8 },
          background: theme.bg,
          cornerRadius: rem * 0.55,
          border: { width: 1, color: theme.fieldBorder },
          overflow: "hidden",
        }}
      >
        <Text style={{ fontSize: rem * 0.85, color: theme.muted, selectable: false }}>
          vim mode — any key closes this
        </Text>
        <Box style={{ gap: rem * 1.5 }}>
          {columns.map((column, at) => (
            <Box key={at} style={{ flexGrow: 1, flexBasis: 0, flexDirection: "column" }}>
              {column.map((section) => (
                <Section key={section.title} section={section} rem={rem} theme={theme} />
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </>
  );
}

function Section({
  section,
  rem,
  theme,
}: {
  section: HelpSection;
  rem: number;
  theme: Theme;
}) {
  return (
    <Box style={{ flexDirection: "column", padding: { bottom: rem * 0.5 } }}>
      <Text
        style={{
          fontSize: rem * 0.78,
          color: theme.accent,
          wrap: false,
          selectable: false,
          padding: { bottom: rem * 0.15 },
        }}
      >
        {section.title}
      </Text>
      {section.rows.map((row) => (
        <Box key={row.label} style={{ height: rem * 1.15, alignItems: "center" }}>
          <Text
            style={{
              width: rem * 5.5,
              flexShrink: 0,
              fontSize: rem * 0.78,
              color: theme.fg,
              wrap: false,
              selectable: false,
            }}
          >
            {row.keys}
          </Text>
          <Text
            style={{
              flexGrow: 1,
              flexBasis: 0,
              fontSize: rem * 0.78,
              color: theme.muted,
              wrap: false,
              selectable: false,
              overflow: "hidden",
            }}
          >
            {row.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function balance(sections: HelpSection[], count: number): HelpSection[][] {
  const columns: HelpSection[][] = Array.from({ length: count }, () => []);
  const heights = new Array(count).fill(0);
  for (const section of sections) {
    const shortest = heights.indexOf(Math.min(...heights));
    columns[shortest].push(section);
    heights[shortest] += section.rows.length + 2;
  }
  return columns;
}
