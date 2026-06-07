export type Product = {
  id: string;
  name: string;
  releaseDate: string;
  normalCardCount: number;
  hasSecret: boolean;
};

export const initialProducts: Product[] = [
  {
    id: "vol1",
    name: "ミニフォトカード Vol.1",
    releaseDate: "2023-04-26",
    normalCardCount: 5,
    hasSecret: true,
  },
  {
    id: "vol2",
    name: "ミニフォトカード Vol.2",
    releaseDate: "2023-07-05",
    normalCardCount: 5,
    hasSecret: true,
  },
  {
    id: "vol3",
    name: "ミニフォトカード Vol.3",
    releaseDate: "2023-10-18",
    normalCardCount: 5,
    hasSecret: true,
  },
  {
    id: "vol4",
    name: "ミニフォトカード Vol.4",
    releaseDate: "2024-01-31",
    normalCardCount: 5,
    hasSecret: true,
  },
  {
    id: "iconoijoy2023",
    name: "イコノイジョイ2023 ミニフォトカード",
    releaseDate: "2023-07-29",
    normalCardCount: 5,
    hasSecret: true,
  },
];