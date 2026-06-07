export type CardDefinition = {
  id: string;
  label: string;
  isSecret: boolean;
};

export const defaultCards: CardDefinition[] = [
  { id: "card1", label: "①", isSecret: false },
  { id: "card2", label: "②", isSecret: false },
  { id: "card3", label: "③", isSecret: false },
  { id: "card4", label: "④", isSecret: false },
  { id: "card5", label: "⑤", isSecret: false },
  { id: "secret", label: "？", isSecret: true },
];