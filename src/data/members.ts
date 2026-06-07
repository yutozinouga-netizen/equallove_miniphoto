export type GroupId = "equal_love" | "not_equal_me" | "nearly_equal_joy";

export type Member = {
  id: string;
  name: string;
  kana: string;
  group: GroupId;
  active: boolean;
  sortOrder: number;
};

export const initialMembers: Member[] = [
  {
    id: "otani_emiri",
    name: "大谷映美里",
    kana: "おおたにえみり",
    group: "equal_love",
    active: true,
    sortOrder: 1,
  },
  {
    id: "oba_hana",
    name: "大場花菜",
    kana: "おおばはな",
    group: "equal_love",
    active: true,
    sortOrder: 2,
  },
  {
    id: "otoshima_risa",
    name: "音嶋莉沙",
    kana: "おとしまりさ",
    group: "equal_love",
    active: true,
    sortOrder: 3,
  },
  {
    id: "saito_kiara",
    name: "齋藤樹愛羅",
    kana: "さいとうきあら",
    group: "equal_love",
    active: true,
    sortOrder: 4,
  },
  {
    id: "sasaki_maika",
    name: "佐々木舞香",
    kana: "ささきまいか",
    group: "equal_love",
    active: true,
    sortOrder: 5,
  },
  {
    id: "takamatsu_hitomi",
    name: "髙松瞳",
    kana: "たかまつひとみ",
    group: "equal_love",
    active: true,
    sortOrder: 6,
  },
  {
    id: "takiwaki_shoko",
    name: "瀧脇笙古",
    kana: "たきわきしょうこ",
    group: "equal_love",
    active: true,
    sortOrder: 7,
  },
  {
    id: "noguchi_iori",
    name: "野口衣織",
    kana: "のぐちいおり",
    group: "equal_love",
    active: true,
    sortOrder: 8,
  },
  {
    id: "morohashi_sana",
    name: "諸橋沙夏",
    kana: "もろはしさな",
    group: "equal_love",
    active: true,
    sortOrder: 9,
  },
  {
    id: "yamamoto_anna",
    name: "山本杏奈",
    kana: "やまもとあんな",
    group: "equal_love",
    active: true,
    sortOrder: 10,
  },
];