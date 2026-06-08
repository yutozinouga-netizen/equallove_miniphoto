import { useEffect, useMemo, useState } from "react";
import { initialMembers, type GroupId, type Member } from "./data/members";
import { initialProducts, type Product as BaseProduct } from "./data/products";

type GroupFilter = "all" | GroupId;

type CardDefinition = {
  id: string;
  label: string;
  isSecret: boolean;
};

type AppProduct = BaseProduct & {
  targetMemberIds?: string[];
  importedMemberImageCount?: number;
  cardCountOverrides?: Record<string, number>;
};

type AppMember = Member & {
  graduationDate?: string;
};

type ImportImageLayout = "auto" | "fixedFive" | "vertical" | "grid3x2" | "detect";
type ProductTargetGroup = GroupId | "all_groups";
const NO_TARGET_MEMBER_SELECTION = "__none__";

const groupLabels: Record<GroupFilter, string> = {
  all: "すべて",
  equal_love: "=LOVE",
  not_equal_me: "≠ME",
  nearly_equal_joy: "≒JOY",
};

const productTargetGroupLabels: Record<ProductTargetGroup, string> = {
  all_groups: "全グループ",
  equal_love: "=LOVE",
  not_equal_me: "≠ME",
  nearly_equal_joy: "≒JOY",
};

const productTargetGroupOrder: Record<GroupId, number> = {
  equal_love: 0,
  not_equal_me: 1,
  nearly_equal_joy: 2,
};

const groupThemes: Record<GroupId, { main: string; pale: string; border: string; text: string }> = {
  equal_love: { main: "#ff4fa3", pale: "#fff0f7", border: "#fbcfe8", text: "#db2777" },
  not_equal_me: { main: "#38bdf8", pale: "#e0f7ff", border: "#bae6fd", text: "#0369a1" },
  nearly_equal_joy: { main: "#facc15", pale: "#fff7cc", border: "#fde68a", text: "#92400e" },
};

function getGroupTheme(group: GroupId) {
  return groupThemes[group] ?? groupThemes.equal_love;
}

function isMemberAfterGraduation(member: Member, releaseDate: string) {
  const graduationDate = (member as AppMember).graduationDate;
  if (!graduationDate || !releaseDate || releaseDate === "未設定") return false;
  return releaseDate >= graduationDate;
}


const IMAGE_DB_NAME = "ikonoijoy-miniphoto-images";
const IMAGE_DB_VERSION = 1;
const IMAGE_STORE_NAME = "imageMaps";

type ImageMapKey =
  | "cardImages"
  | "memberImages"
  | "productLineupImages"
  | "productCroppedImages";

function openImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        database.createObjectStore(IMAGE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadImageMap<T>(key: ImageMapKey, fallback: T): Promise<T> {
  try {
    const database = await openImageDatabase();

    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return fallback;
  }
}

async function saveImageMap<T>(key: ImageMapKey, value: T): Promise<void> {
  try {
    const database = await openImageDatabase();

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`${key} could not be saved to IndexedDB.`, error);
  }
}

function createCards(product: AppProduct): CardDefinition[] {
  const normalCards = Array.from(
    { length: product.normalCardCount },
    (_, index) => ({
      id: `card${index + 1}`,
      label: `${index + 1}`,
      isSecret: false,
    })
  );

  if (!product.hasSecret) return normalCards;

  return [...normalCards, { id: "secret", label: "？", isSecret: true }];
}

function getExpandedCardCropArea(
  box: { x1: number; y1: number; x2: number; y2: number },
  imageWidth: number,
  imageHeight: number
) {
  const boxWidth = box.x2 - box.x1 + 1;
  const boxHeight = box.y2 - box.y1 + 1;

  // ミニフォト本体は約55mm×89mm。
  // 自動検出は人物・文字などの色付き部分を拾うため、白い下部ロゴ領域を取り逃がしやすい。
  // そのため、検出枠からカード全体比率に近づくように下方向を広めに残す。
  const cardAspectRatio = 55 / 89;
  const horizontalPadding = Math.max(8, Math.round(boxWidth * 0.06));
  const topPadding = Math.max(6, Math.round(boxHeight * 0.04));
  const bottomPadding = Math.max(24, Math.round(boxHeight * 0.28));

  let cropWidth = boxWidth + horizontalPadding * 2;
  let cropHeight = boxHeight + topPadding + bottomPadding;
  cropHeight = Math.max(cropHeight, Math.round(cropWidth / cardAspectRatio));

  let cropX = box.x1 - horizontalPadding;
  let cropY = box.y1 - topPadding;

  if (cropX < 0) cropX = 0;
  if (cropY < 0) cropY = 0;

  if (cropX + cropWidth > imageWidth) {
    cropX = Math.max(0, imageWidth - cropWidth);
  }

  if (cropY + cropHeight > imageHeight) {
    cropY = Math.max(0, imageHeight - cropHeight);
  }

  const sx = Math.max(0, Math.floor(cropX));
  const sy = Math.max(0, Math.floor(cropY));
  const sw = Math.max(1, Math.min(imageWidth - sx, Math.ceil(cropWidth)));
  const sh = Math.max(1, Math.min(imageHeight - sy, Math.ceil(cropHeight)));

  return { sx, sy, sw, sh };
}

function App() {
  const [activeTab, setActiveTab] = useState<"collection" | "products" | "members" | "data">(() => {
    const saved = localStorage.getItem("activeTab");
    if (
      saved === "collection" ||
      saved === "products" ||
      saved === "members" ||
      saved === "data"
    ) {
      return saved;
    }
    return "collection";
  });
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>(() => {
    const saved = localStorage.getItem("groupFilter");
    if (
      saved === "all" ||
      saved === "equal_love" ||
      saved === "not_equal_me" ||
      saved === "nearly_equal_joy"
    ) {
      return saved;
    }
    return "all";
  });
  const [selectedMemberId, setSelectedMemberId] = useState(() => {
    return localStorage.getItem("selectedMemberId") ?? "sasaki_maika";
  });

  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberKana, setNewMemberKana] = useState("");
  const [newMemberGroup, setNewMemberGroup] = useState<GroupId>("not_equal_me");
  const [newMemberGraduationDate, setNewMemberGraduationDate] = useState("");

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState("");
  const [editingMemberKana, setEditingMemberKana] = useState("");
  const [editingMemberGroup, setEditingMemberGroup] = useState<GroupId>("equal_love");
  const [editingMemberGraduationDate, setEditingMemberGraduationDate] = useState("");

  const [productUrl, setProductUrl] = useState("");
  const [isImportingProduct, setIsImportingProduct] = useState(false);

  const [newProductName, setNewProductName] = useState("");
  const [newProductReleaseDate, setNewProductReleaseDate] = useState("");
  const [newProductNormalCardCount, setNewProductNormalCardCount] = useState(5);
  const [newProductHasSecret, setNewProductHasSecret] = useState(true);
  const [newProductTargetGroup, setNewProductTargetGroup] = useState<ProductTargetGroup>("equal_love");
  const [newProductTargetMemberIds, setNewProductTargetMemberIds] = useState<string[]>([]);
  const [newProductCardCountOverrides, setNewProductCardCountOverrides] = useState<Record<string, number>>({});
  const [pendingProductLineupImage, setPendingProductLineupImage] = useState("");
  const [pendingProductMemberImages, setPendingProductMemberImages] = useState<string[]>([]);
  const [selectedImportImageIndexes, setSelectedImportImageIndexes] = useState<number[]>([]);
  const [newProductImportImageLayout, setNewProductImportImageLayout] =
    useState<ImportImageLayout>("auto");
  const [importPresetHint, setImportPresetHint] = useState("");

  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingProductName, setEditingProductName] = useState("");
  const [editingProductReleaseDate, setEditingProductReleaseDate] = useState("");
  const [editingProductNormalCardCount, setEditingProductNormalCardCount] = useState(5);
  const [editingProductHasSecret, setEditingProductHasSecret] = useState(true);
  const [editingProductTargetGroup, setEditingProductTargetGroup] = useState<ProductTargetGroup>("equal_love");
  const [editingProductTargetMemberIds, setEditingProductTargetMemberIds] = useState<string[]>([]);
  const [editingProductCardCountOverrides] = useState<Record<string, number>>({});

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCount, setEditingCount] = useState(0);
  const [longPressTimer, setLongPressTimer] = useState<number | null>(null);
  const [longPressTriggered, setLongPressTriggered] = useState(false);

  const [cropProductId, setCropProductId] = useState<string | null>(null);
  const [cropColumns, setCropColumns] = useState(10);
  const [croppedImages, setCroppedImages] = useState<string[]>([]);
  const [imageStorageReady, setImageStorageReady] = useState(false);

  const [members, setMembers] = useState<Member[]>(() => {
    const saved = localStorage.getItem("members");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return initialMembers;
      }
    }
    return initialMembers;
  });

  const [products, setProducts] = useState<AppProduct[]>(() => {
    const saved = localStorage.getItem("products");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return initialProducts;
      }
    }
    return initialProducts;
  });

  const [ownedCounts, setOwnedCounts] = useState<Record<string, number>>(() => {
    const savedCounts = localStorage.getItem("ownedCounts");
    if (savedCounts) {
      try {
        return JSON.parse(savedCounts);
      } catch {
        return {};
      }
    }

    const oldOwnedCards = localStorage.getItem("ownedCards");
    if (oldOwnedCards) {
      try {
        const parsed: Record<string, boolean> = JSON.parse(oldOwnedCards);
        return Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, value ? 1 : 0])
        );
      } catch {
        return {};
      }
    }

    return {};
  });

  const [cardImages, setCardImages] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("cardImages");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });

  const [memberImages, setMemberImages] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("memberImages");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });

  const [productLineupImages, setProductLineupImages] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("productLineupImages");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });

  const [productCroppedImages, setProductCroppedImages] = useState<Record<string, string[]>>(() => {
    const saved = localStorage.getItem("productCroppedImages");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });

  useEffect(() => {
    document.title = "イコノイジョイミニフォトカード管理";

    const upsertMeta = (name: string, content: string, attr: "name" | "property" = "name") => {
      let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    upsertMeta("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
    upsertMeta("theme-color", "#ff4fa3");
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("apple-mobile-web-app-status-bar-style", "default");
    upsertMeta("apple-mobile-web-app-title", "イコノイジョイ管理");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // ローカル開発環境などで未配置の場合は何もしない。
      });
    }
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      setIsCompactLayout(window.matchMedia("(max-width: 860px)").matches);
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStoredImages = async () => {
      const [storedCardImages, storedMemberImages, storedProductLineupImages, storedProductCroppedImages] =
        await Promise.all([
          loadImageMap<Record<string, string>>("cardImages", {}),
          loadImageMap<Record<string, string>>("memberImages", {}),
          loadImageMap<Record<string, string>>("productLineupImages", {}),
          loadImageMap<Record<string, string[]>>("productCroppedImages", {}),
        ]);

      if (cancelled) return;

      setCardImages(storedCardImages);
      setMemberImages(storedMemberImages);
      setProductLineupImages(storedProductLineupImages);
      setProductCroppedImages(storedProductCroppedImages);
      setImageStorageReady(true);
    };

    loadStoredImages();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("ownedCounts", JSON.stringify(ownedCounts));
  }, [ownedCounts]);

  useEffect(() => {
    if (!imageStorageReady) return;
    saveImageMap("cardImages", cardImages);
  }, [cardImages, imageStorageReady]);

  useEffect(() => {
    if (!imageStorageReady) return;
    saveImageMap("memberImages", memberImages);
  }, [memberImages, imageStorageReady]);

  useEffect(() => {
    if (!imageStorageReady) return;
    saveImageMap("productLineupImages", productLineupImages);
  }, [productLineupImages, imageStorageReady]);

  useEffect(() => {
    if (!imageStorageReady) return;
    saveImageMap("productCroppedImages", productCroppedImages);
  }, [productCroppedImages, imageStorageReady]);

  useEffect(() => {
    localStorage.setItem("members", JSON.stringify(members));
  }, [members]);

  useEffect(() => {
    localStorage.setItem("products", JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("groupFilter", groupFilter);
  }, [groupFilter]);

  useEffect(() => {
    localStorage.setItem("selectedMemberId", selectedMemberId);
  }, [selectedMemberId]);

  const filteredMembers = useMemo(() => {
    return members
      .filter((member) => member.active)
      .filter((member) => groupFilter === "all" || member.group === groupFilter)
      .sort((a, b) => a.kana.localeCompare(b.kana, "ja"));
  }, [members, groupFilter]);

  const selectedMember =
    members.find((member) => member.id === selectedMemberId) ??
    filteredMembers[0] ??
    members[0];

  useEffect(() => {
    if (!selectedMember) return;
    const exists = members.some((member) => member.id === selectedMemberId);
    if (!exists) {
      setSelectedMemberId(selectedMember.id);
    }
  }, [members, selectedMember, selectedMemberId]);

  const selectedGroupTheme = getGroupTheme(selectedMember?.group ?? "equal_love");

  const renderMemberAvatar = (member: Member, size = 78) => {
    const image = memberImages[member.id];
    const theme = getGroupTheme(member.group);

    return (
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "50%",
          background: theme.pale,
          border: `1px solid ${theme.border}`,
          display: "grid",
          placeItems: "center",
          color: theme.main,
          fontWeight: 900,
          fontSize: `${Math.max(18, Math.round(size * 0.36))}px`,
          overflow: "hidden",
          flex: "0 0 auto",
          boxShadow: "0 10px 22px rgba(236, 72, 153, 0.12)",
        }}
      >
        {image ? (
          <img
            src={image}
            alt={member.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          member.name.slice(0, 1)
        )}
      </div>
    );
  };

  const getTargetMembers = (targetGroup: ProductTargetGroup, selectedIds: string[]) => {
    const groupMembers = members
      .filter((member) => {
        if (!member.active) return false;
        if (targetGroup === "all_groups") return true;
        return member.group === targetGroup;
      })
      .sort((a, b) => {
        if (targetGroup === "all_groups" && a.group !== b.group) {
          return productTargetGroupOrder[a.group] - productTargetGroupOrder[b.group];
        }

        return a.kana.localeCompare(b.kana, "ja");
      });

    if (selectedIds.includes(NO_TARGET_MEMBER_SELECTION)) {
      return [];
    }

    if (selectedIds.length === 0) {
      return groupMembers;
    }

    return groupMembers.filter((member) => selectedIds.includes(member.id));
  };

  const toggleTargetMember = (
    memberId: string,
    selectedIds: string[],
    setSelectedIds: (ids: string[]) => void
  ) => {
    if (selectedIds.includes(memberId)) {
      setSelectedIds(selectedIds.filter((id) => id !== memberId));
      return;
    }

    setSelectedIds([...selectedIds, memberId]);
  };

  const toggleImportImageSelection = (imageIndex: number) => {
    setSelectedImportImageIndexes((prev) => {
      if (prev.includes(imageIndex)) {
        return prev.filter((index) => index !== imageIndex);
      }

      return [...prev, imageIndex].sort((a, b) => a - b);
    });
  };

  const selectAllImportImages = () => {
    setSelectedImportImageIndexes(
      pendingProductMemberImages.map((_, index) => index)
    );
  };

  const clearImportImageSelection = () => {
    setSelectedImportImageIndexes([]);
  };

  const getSelectedImportImages = () => {
    return selectedImportImageIndexes
      .filter((index) => index >= 0 && index < pendingProductMemberImages.length)
      .sort((a, b) => a - b)
      .map((index) => pendingProductMemberImages[index])
      .filter(Boolean);
  };

  const getImportImageGeneratedMemberCount = () => {
    const selectedImageCount = selectedImportImageIndexes.length;

    if (newProductImportImageLayout === "grid3x2") {
      return selectedImageCount * 3;
    }

    return selectedImageCount;
  };

  const getRequiredImportImageCount = (
    targetMemberCount: number,
    layout: ImportImageLayout,
    targetGroup: ProductTargetGroup = newProductTargetGroup,
    selectedIds: string[] = newProductTargetMemberIds
  ) => {
    if (targetMemberCount <= 0) return 0;

    if (layout === "grid3x2") {
      if (targetGroup === "all_groups") {
        return (["equal_love", "not_equal_me", "nearly_equal_joy"] as GroupId[]).reduce(
          (sum, group) => {
            const groupCount = getTargetMembers(group, selectedIds).length;
            return sum + Math.ceil(groupCount / 3);
          },
          0
        );
      }

      return Math.ceil(targetMemberCount / 3);
    }

    return targetMemberCount;
  };

  const getGrid3x2ImageOffsetForGroup = (targetGroup: ProductTargetGroup) => {
    if (targetGroup === "all_groups") return 0;

    const groups: GroupId[] = ["equal_love", "not_equal_me", "nearly_equal_joy"];
    let offset = 0;

    for (const group of groups) {
      if (group === targetGroup) return offset;
      const groupMemberCount = getTargetMembers(group, []).length;
      offset += Math.ceil(groupMemberCount / 3);
    }

    return 0;
  };

  const selectImportImagesByRequiredCount = (requiredCount: number) => {
    const startIndex = newProductImportImageLayout === "grid3x2"
      ? getGrid3x2ImageOffsetForGroup(newProductTargetGroup)
      : 0;
    const safeCount = Math.max(
      0,
      Math.min(requiredCount, Math.max(0, pendingProductMemberImages.length - startIndex))
    );

    setSelectedImportImageIndexes(
      Array.from({ length: safeCount }, (_, index) => startIndex + index)
    );
  };

  const selectImportImagesByRequiredCountFrom = (
    requiredCount: number,
    sourceImages: string[],
    startIndex = 0
  ) => {
    const safeCount = Math.max(0, Math.min(requiredCount, Math.max(0, sourceImages.length - startIndex)));
    setSelectedImportImageIndexes(
      Array.from({ length: safeCount }, (_, index) => startIndex + index)
    );
  };

  const inferGroupFromImportedProduct = (url: string, productName: string): ProductTargetGroup => {
    const normalizedUrl = url.toLowerCase();

    if (normalizedUrl.includes("ikonoijoy") || productName.includes("イコノイジョイ")) {
      return "all_groups";
    }

    if (normalizedUrl.includes("notequalme") || productName.includes("≠ME")) {
      return "not_equal_me";
    }

    if (normalizedUrl.includes("nearlyequaljoy") || productName.includes("≒JOY")) {
      return "nearly_equal_joy";
    }

    return "equal_love";
  };

  const applyAutoImportPreset = (
    importedImages: string[],
    importedUrl: string,
    importedProductName: string
  ) => {
    const inferredGroup = inferGroupFromImportedProduct(importedUrl, importedProductName);

    if (inferredGroup === "all_groups") {
      setNewProductNormalCardCount(2);
      setNewProductHasSecret(false);
      setNewProductTargetGroup("all_groups");
      setNewProductTargetMemberIds([]);
      setNewProductImportImageLayout("grid3x2");

      const targetMemberCount = getTargetMembers("all_groups", []).length;
      const requiredImageCount = getRequiredImportImageCount(targetMemberCount, "grid3x2", "all_groups", []);
      selectImportImagesByRequiredCountFrom(requiredImageCount, importedImages);
      setImportPresetHint(
        "自動判定：イコノイジョイ混在商品として、全グループ・2種・3名×縦2種に設定しました。必要なら手動で切り替えてね。"
      );
      return;
    }

    setNewProductNormalCardCount(5);
    setNewProductHasSecret(true);
    setNewProductTargetGroup(inferredGroup);
    setNewProductTargetMemberIds([]);
    setNewProductImportImageLayout("fixedFive");

    const targetMemberCount = getTargetMembers(inferredGroup, []).length;
    selectImportImagesByRequiredCountFrom(targetMemberCount, importedImages);
    setImportPresetHint(
      `自動判定：${productTargetGroupLabels[inferredGroup]}の通常商品として、5種・通常5枚切り出しに設定しました。必要なら手動で切り替えてね。`
    );
  };

  const applyNormalImportPreset = () => {
    setNewProductNormalCardCount(5);
    setNewProductHasSecret(true);
    setNewProductImportImageLayout("fixedFive");
    setImportPresetHint("手動切替：通常商品として、5種・通常5枚切り出しに設定しました。");

    const targetMemberCount = getTargetMembers(
      newProductTargetGroup,
      newProductTargetMemberIds
    ).length;

    selectImportImagesByRequiredCount(targetMemberCount);
  };

  const applyMixedImportPreset = () => {
    setNewProductNormalCardCount(2);
    setNewProductHasSecret(false);
    setNewProductImportImageLayout("grid3x2");
    setImportPresetHint("手動切替：混在商品として、全グループ・2種・3名×縦2種に設定しました。");
    setNewProductTargetGroup("all_groups");
    setNewProductTargetMemberIds([]);

    const targetMemberCount = getTargetMembers("all_groups", []).length;
    selectImportImagesByRequiredCount(getRequiredImportImageCount(targetMemberCount, "grid3x2", "all_groups", []));
  };


  useEffect(() => {
    if (pendingProductMemberImages.length === 0) return;

    const targetMemberCount = getTargetMembers(
      newProductTargetGroup,
      newProductTargetMemberIds
    ).length;
    const requiredImageCount = getRequiredImportImageCount(
      targetMemberCount,
      newProductImportImageLayout,
      newProductTargetGroup,
      newProductTargetMemberIds
    );

    if (requiredImageCount <= 0) return;

    setSelectedImportImageIndexes((prev) => {
      const current = prev
        .filter((index) => index >= 0 && index < pendingProductMemberImages.length)
        .sort((a, b) => a - b);

      if (current.length === requiredImageCount) {
        return current;
      }

      const startIndex = newProductImportImageLayout === "grid3x2"
        ? getGrid3x2ImageOffsetForGroup(newProductTargetGroup)
        : 0;
      const safeCount = Math.min(
        requiredImageCount,
        Math.max(0, pendingProductMemberImages.length - startIndex)
      );

      return Array.from({ length: safeCount }, (_, index) => startIndex + index);
    });
  }, [
    pendingProductMemberImages.length,
    newProductImportImageLayout,
    newProductTargetGroup,
    newProductTargetMemberIds,
  ]);

  const getProductTargetMembers = (product: AppProduct) => {
    const fallbackGroup = selectedMember.group;
    const ids = product.targetMemberIds ?? [];
    const targetMembers =
      ids.length > 0
        ? members
            .filter((member) => ids.includes(member.id))
            .sort((a, b) => a.kana.localeCompare(b.kana, "ja"))
        : members
            .filter((member) => member.active && member.group === fallbackGroup)
            .sort((a, b) => a.kana.localeCompare(b.kana, "ja"));

    return targetMembers;
  };

  const createCardsForMember = (product: AppProduct, memberId: string) => {
    const cardCount = product.cardCountOverrides?.[memberId] ?? product.normalCardCount;
    return createCards({ ...product, normalCardCount: Math.max(1, cardCount) });
  };

  const visibleProducts = useMemo(() => {
    return products.filter((product) => {
      const targetMemberIds = product.targetMemberIds ?? [];

      if (targetMemberIds.length === 0) {
        return true;
      }

      return targetMemberIds.includes(selectedMember.id);
    });
  }, [products, selectedMember.id]);

  const memberStats = useMemo(() => {
    const totalCards = visibleProducts.reduce(
      (sum, product) => sum + createCardsForMember(product, selectedMember.id).length,
      0
    );

    const ownedUniqueCards = visibleProducts.reduce((total, product) => {
      const productOwned = createCardsForMember(product, selectedMember.id).filter((card) => {
        const cardId = `${selectedMember.id}-${product.id}-${card.id}`;
        return (ownedCounts[cardId] ?? 0) > 0;
      }).length;

      return total + productOwned;
    }, 0);

    const totalOwnedCount = visibleProducts.reduce((total, product) => {
      const productCount = createCardsForMember(product, selectedMember.id).reduce((sum, card) => {
        const cardId = `${selectedMember.id}-${product.id}-${card.id}`;
        return sum + (ownedCounts[cardId] ?? 0);
      }, 0);

      return total + productCount;
    }, 0);

    const percentage =
      totalCards === 0
        ? 0
        : Math.round((ownedUniqueCards / totalCards) * 1000) / 10;

    return { totalCards, ownedUniqueCards, totalOwnedCount, percentage };
  }, [ownedCounts, visibleProducts, selectedMember.id]);

  const getProductStats = (product: AppProduct) => {
    const cards = createCardsForMember(product, selectedMember.id);
    const totalCards = cards.length;

    const ownedUniqueCards = cards.filter((card) => {
      const cardId = `${selectedMember.id}-${product.id}-${card.id}`;
      return (ownedCounts[cardId] ?? 0) > 0;
    }).length;

    const totalOwnedCount = cards.reduce((sum, card) => {
      const cardId = `${selectedMember.id}-${product.id}-${card.id}`;
      return sum + (ownedCounts[cardId] ?? 0);
    }, 0);

    const percentage =
      totalCards === 0
        ? 0
        : Math.round((ownedUniqueCards / totalCards) * 1000) / 10;

    return { totalCards, ownedUniqueCards, totalOwnedCount, percentage };
  };

  const toggleOwned = (cardId: string) => {
    setOwnedCounts((prev) => {
      const current = prev[cardId] ?? 0;
      return { ...prev, [cardId]: current > 0 ? 0 : 1 };
    });
  };

  const openCountEditor = (cardId: string, count: number) => {
    setEditingCardId(cardId);
    setEditingCount(count);
  };

  const startLongPress = (cardId: string, count: number) => {
    setLongPressTriggered(false);

    const timer = window.setTimeout(() => {
      setLongPressTriggered(true);
      openCountEditor(cardId, count);
    }, 550);

    setLongPressTimer(timer);
  };

  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const handleCardClick = (cardId: string) => {
    if (longPressTriggered) {
      setLongPressTriggered(false);
      return;
    }

    toggleOwned(cardId);
  };

  const uploadCardImage = (file: File | null) => {
    if (!file || !editingCardId) return;

    const reader = new FileReader();

    reader.onload = async () => {
      const compressedImage = await compressImageForStorage(String(reader.result));

      setCardImages((prev) => ({
        ...prev,
        [editingCardId]: compressedImage,
      }));
    };

    reader.readAsDataURL(file);
  };

  const removeCardImage = () => {
    if (!editingCardId) return;

    setCardImages((prev) => {
      const next = { ...prev };
      delete next[editingCardId];
      return next;
    });
  };

  const uploadMemberImage = (memberId: string, file: File | null) => {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      const compressedImage = await compressMemberImageForStorage(String(reader.result));

      setMemberImages((prev) => ({
        ...prev,
        [memberId]: compressedImage,
      }));
    };

    reader.readAsDataURL(file);
  };

  const removeMemberImage = (memberId: string) => {
    setMemberImages((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
  };

  const saveCount = () => {
    if (!editingCardId) return;
    setOwnedCounts((prev) => ({
      ...prev,
      [editingCardId]: Math.max(0, editingCount),
    }));
    setEditingCardId(null);
  };

  const handleGroupChange = (value: GroupFilter) => {
    setGroupFilter(value);

    const nextMembers = members
      .filter((member) => member.active)
      .filter((member) => value === "all" || member.group === value)
      .sort((a, b) => a.kana.localeCompare(b.kana, "ja"));

    if (nextMembers.length > 0) {
      setSelectedMemberId(nextMembers[0].id);
    }
  };

  const addMember = () => {
    const name = newMemberName.trim();
    const kana = newMemberKana.trim();

    if (!name || !kana) {
      alert("名前とよみを入力してね");
      return;
    }

    const id =
      newMemberGroup +
      "_" +
      kana.replace(/\s/g, "").replace(/[^\wぁ-んァ-ン一-龥]/g, "") +
      "_" +
      Date.now();

    const sameGroupMembers = members.filter(
      (member) => member.group === newMemberGroup
    );

    const nextMember: AppMember = {
      id,
      name,
      kana,
      group: newMemberGroup,
      active: true,
      sortOrder: sameGroupMembers.length + 1,
      graduationDate: newMemberGraduationDate || undefined,
    };

    setMembers((prev) =>
      [...prev, nextMember].sort((a, b) => {
        if (a.group !== b.group) return a.group.localeCompare(b.group);
        return a.sortOrder - b.sortOrder;
      })
    );

    setGroupFilter(newMemberGroup);
    setSelectedMemberId(id);
    setNewMemberName("");
    setNewMemberKana("");
    setNewMemberGraduationDate("");
  };

  const openMemberEditor = (member: Member) => {
    setEditingMemberId(member.id);
    setEditingMemberName(member.name);
    setEditingMemberKana(member.kana);
    setEditingMemberGroup(member.group);
    setEditingMemberGraduationDate((member as AppMember).graduationDate ?? "");
  };

  const saveMemberEdit = () => {
    if (!editingMemberId) return;

    const name = editingMemberName.trim();
    const kana = editingMemberKana.trim();

    if (!name || !kana) {
      alert("名前とよみを入力してね");
      return;
    }

    setMembers((prev) =>
      prev.map((member) =>
        member.id === editingMemberId
          ? {
              ...member,
              name,
              kana,
              group: editingMemberGroup,
              graduationDate: editingMemberGraduationDate || undefined,
            }
          : member
      )
    );

    setGroupFilter(editingMemberGroup);
    setSelectedMemberId(editingMemberId);
    setEditingMemberId(null);
  };

  const deleteMember = (memberId: string) => {
    const member = members.find((item) => item.id === memberId);
    if (!member) return;

    const shouldDelete = window.confirm(
      `「${member.name}」を削除しますか？\n\nOK：メンバーとこのメンバーの所持データを削除\nキャンセル：削除しない`
    );

    if (!shouldDelete) return;

    const nextMembers = members.filter((item) => item.id !== memberId);
    setMembers(nextMembers);

    setOwnedCounts((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cardId) => {
        if (cardId.startsWith(`${memberId}-`)) {
          delete next[cardId];
        }
      });
      return next;
    });

    setCardImages((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cardId) => {
        if (cardId.startsWith(`${memberId}-`)) {
          delete next[cardId];
        }
      });
      return next;
    });

    setMemberImages((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });

    const nextActiveMembers = nextMembers
      .filter((item) => item.active)
      .filter((item) => groupFilter === "all" || item.group === groupFilter)
      .sort((a, b) => a.kana.localeCompare(b.kana, "ja"));

    if (nextActiveMembers.length > 0) {
      setSelectedMemberId(nextActiveMembers[0].id);
    } else if (nextMembers.length > 0) {
      setGroupFilter("all");
      setSelectedMemberId(nextMembers[0].id);
    }
  };

  const detectCardImagesFromLineupImage = (lineupImage: string, targetCardCount: number) => {
    return new Promise<string[]>((resolve) => {
      if (!lineupImage || targetCardCount <= 0) {
        resolve([]);
        return;
      }

      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;

        const context = canvas.getContext("2d");
        if (!context) {
          resolve([]);
          return;
        }

        context.drawImage(image, 0, 0);

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        const isCardPixel = (x: number, y: number) => {
          const index = (y * width + x) * 4;
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];

          return !(r > 245 && g > 245 && b > 245);
        };

        const visited = new Uint8Array(width * height);
        const boxes: Array<{ x1: number; y1: number; x2: number; y2: number; area: number }> = [];

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const startIndex = y * width + x;

            if (visited[startIndex] || !isCardPixel(x, y)) {
              continue;
            }

            const queue: Array<[number, number]> = [[x, y]];
            visited[startIndex] = 1;

            let x1 = x;
            let y1 = y;
            let x2 = x;
            let y2 = y;
            let area = 0;

            while (queue.length > 0) {
              const [cx, cy] = queue.pop()!;
              area += 1;

              if (cx < x1) x1 = cx;
              if (cy < y1) y1 = cy;
              if (cx > x2) x2 = cx;
              if (cy > y2) y2 = cy;

              const neighbors = [
                [cx + 1, cy],
                [cx - 1, cy],
                [cx, cy + 1],
                [cx, cy - 1],
              ];

              neighbors.forEach(([nx, ny]) => {
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;

                const neighborIndex = ny * width + nx;

                if (visited[neighborIndex] || !isCardPixel(nx, ny)) return;

                visited[neighborIndex] = 1;
                queue.push([nx, ny]);
              });
            }

            const boxWidth = x2 - x1 + 1;
            const boxHeight = y2 - y1 + 1;
            const aspect = boxWidth / boxHeight;

            if (
              area > 300 &&
              boxWidth > 20 &&
              boxHeight > 35 &&
              aspect > 0.35 &&
              aspect < 0.95
            ) {
              boxes.push({ x1, y1, x2, y2, area });
            }
          }
        }

        const mergedBoxes: typeof boxes = [];

        boxes
          .sort((a, b) => b.area - a.area)
          .forEach((box) => {
            const overlaps = mergedBoxes.some((existing) => {
              const ix1 = Math.max(existing.x1, box.x1);
              const iy1 = Math.max(existing.y1, box.y1);
              const ix2 = Math.min(existing.x2, box.x2);
              const iy2 = Math.min(existing.y2, box.y2);

              if (ix2 <= ix1 || iy2 <= iy1) return false;

              const intersection = (ix2 - ix1) * (iy2 - iy1);
              const boxArea = (box.x2 - box.x1) * (box.y2 - box.y1);

              return intersection / boxArea > 0.35;
            });

            if (!overlaps) {
              mergedBoxes.push(box);
            }
          });

        const sortedBoxes = mergedBoxes
          .sort((a, b) => {
            const rowThreshold = Math.max(12, (a.y2 - a.y1) * 0.45);

            if (Math.abs(a.y1 - b.y1) > rowThreshold) {
              return a.y1 - b.y1;
            }

            return a.x1 - b.x1;
          })
          .slice(0, targetCardCount);

        if (sortedBoxes.length === 0) {
          resolve([]);
          return;
        }

        const nextCrops = sortedBoxes.map((box) => {
          const { sx, sy, sw, sh } = getExpandedCardCropArea(box, width, height);

          const scale = 3;
          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = Math.floor(sw * scale);
          cropCanvas.height = Math.floor(sh * scale);

          const cropContext = cropCanvas.getContext("2d");
          if (!cropContext) return "";

          cropContext.imageSmoothingEnabled = true;
          cropContext.imageSmoothingQuality = "high";
          cropContext.drawImage(
            canvas,
            sx,
            sy,
            sw,
            sh,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
          );

          return cropCanvas.toDataURL("image/png");
        }).filter(Boolean);

        resolve(nextCrops);
      };

      image.onerror = () => resolve([]);
      image.src = lineupImage;
    });
  };

  const cropImageByRegions = (
    sourceImage: string,
    regions: Array<{ x: number; y: number; width: number; height: number }>
  ) => {
    return new Promise<string[]>((resolve) => {
      if (!sourceImage || regions.length === 0) {
        resolve([]);
        return;
      }

      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;

        const context = canvas.getContext("2d");
        if (!context) {
          resolve([]);
          return;
        }

        context.drawImage(image, 0, 0);

        const cropped = regions
          .map((region) => {
            const sx = Math.max(0, Math.round(region.x));
            const sy = Math.max(0, Math.round(region.y));
            const sw = Math.min(image.width - sx, Math.round(region.width));
            const sh = Math.min(image.height - sy, Math.round(region.height));

            if (sw <= 0 || sh <= 0) return "";

            const scale = 3;
            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = Math.floor(sw * scale);
            cropCanvas.height = Math.floor(sh * scale);

            const cropContext = cropCanvas.getContext("2d");
            if (!cropContext) return "";

            cropContext.imageSmoothingEnabled = true;
            cropContext.imageSmoothingQuality = "high";
            cropContext.drawImage(
              canvas,
              sx,
              sy,
              sw,
              sh,
              0,
              0,
              cropCanvas.width,
              cropCanvas.height
            );

            return cropCanvas.toDataURL("image/png");
          })
          .filter(Boolean);

        resolve(cropped);
      };

      image.onerror = () => resolve([]);
      image.src = sourceImage;
    });
  };

  const splitImportedMemberImage = (
    sourceImage: string,
    normalCardCount: number,
    layout: ImportImageLayout
  ) => {
    return new Promise<string[]>((resolve) => {
      if (!sourceImage || normalCardCount <= 0) {
        resolve([]);
        return;
      }

      const image = new Image();

      image.onload = async () => {
        const width = image.width;
        const height = image.height;
        const resolvedLayout =
          layout === "auto"
            ? normalCardCount === 5
              ? "fixedFive"
              : normalCardCount === 2
              ? "vertical"
              : "detect"
            : layout;

        if (resolvedLayout === "detect") {
          const detected = await detectCardImagesFromLineupImage(sourceImage, normalCardCount);
          resolve(detected.slice(0, normalCardCount));
          return;
        }

        if (resolvedLayout === "fixedFive" && normalCardCount === 5) {
          // Plusmemberの「1メンバー5種」画像は、上段3枚・下段2枚の固定配置。
          // ただしVolごとにカード幅・余白が微妙に違うため、単純な固定座標ではなく、
          // 上段/下段ごとにカードの横位置を検出してから切り出す。
          // 検出できない場合だけ、従来の固定座標へフォールバックする。
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext("2d");
          if (!context) {
            const fallbackRegions = [
              { x: width * 0.09, y: height * 0.075, width: width * 0.245, height: height * 0.405 },
              { x: width * 0.3775, y: height * 0.075, width: width * 0.245, height: height * 0.405 },
              { x: width * 0.665, y: height * 0.075, width: width * 0.245, height: height * 0.405 },
              { x: width * 0.235, y: height * 0.555, width: width * 0.245, height: height * 0.405 },
              { x: width * 0.52, y: height * 0.555, width: width * 0.245, height: height * 0.405 },
            ];
            const fixedCrops = await cropImageByRegions(sourceImage, fallbackRegions);
            resolve(fixedCrops.slice(0, normalCardCount));
            return;
          }

          context.drawImage(image, 0, 0);
          const imageData = context.getImageData(0, 0, width, height);
          const pixels = imageData.data;

          const isNonBackgroundPixel = (x: number, y: number) => {
            const index = (y * width + x) * 4;
            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];
            const a = pixels[index + 3];

            if (a < 10) return false;

            // 真っ白背景だけを除外する。薄いグレー/薄いピンクのカード下部は残したいので、
            // 以前より白判定を少し厳しめにする。
            return !(r > 250 && g > 250 && b > 250);
          };

          const detectRegionsInRow = (
            rowStartRatio: number,
            rowEndRatio: number,
            expectedCount: number
          ) => {
            const yStart = Math.max(0, Math.floor(height * rowStartRatio));
            const yEnd = Math.min(height - 1, Math.ceil(height * rowEndRatio));
            const bandHeight = Math.max(1, yEnd - yStart + 1);
            const xScores = Array.from({ length: width }, () => 0);

            for (let y = yStart; y <= yEnd; y += 1) {
              for (let x = 0; x < width; x += 1) {
                if (isNonBackgroundPixel(x, y)) {
                  xScores[x] += 1;
                }
              }
            }

            const xThreshold = Math.max(4, Math.round(bandHeight * 0.08));
            const rawRuns: Array<{ start: number; end: number }> = [];
            let runStart: number | null = null;

            for (let x = 0; x < width; x += 1) {
              if (xScores[x] >= xThreshold) {
                if (runStart === null) runStart = x;
              } else if (runStart !== null) {
                rawRuns.push({ start: runStart, end: x - 1 });
                runStart = null;
              }
            }

            if (runStart !== null) {
              rawRuns.push({ start: runStart, end: width - 1 });
            }

            const mergedRuns: Array<{ start: number; end: number }> = [];
            const maxGap = Math.max(6, Math.round(width * 0.018));

            rawRuns.forEach((run) => {
              const previous = mergedRuns[mergedRuns.length - 1];

              if (previous && run.start - previous.end <= maxGap) {
                previous.end = run.end;
                return;
              }

              mergedRuns.push({ ...run });
            });

            const candidateRuns = mergedRuns
              .map((run) => ({
                ...run,
                width: run.end - run.start + 1,
              }))
              .filter((run) => run.width >= width * 0.12 && run.width <= width * 0.34)
              .sort((a, b) => b.width - a.width)
              .slice(0, expectedCount)
              .sort((a, b) => a.start - b.start);

            if (candidateRuns.length !== expectedCount) {
              return [];
            }

            return candidateRuns.map((run) => {
              let y1 = yEnd;
              let y2 = yStart;

              for (let y = yStart; y <= yEnd; y += 1) {
                let rowScore = 0;

                for (let x = run.start; x <= run.end; x += 1) {
                  if (isNonBackgroundPixel(x, y)) {
                    rowScore += 1;
                  }
                }

                if (rowScore >= Math.max(3, Math.round((run.end - run.start + 1) * 0.08))) {
                  if (y < y1) y1 = y;
                  if (y > y2) y2 = y;
                }
              }

              if (y2 <= y1) {
                y1 = yStart;
                y2 = yEnd;
              }

              const detectedWidth = run.end - run.start + 1;
              const detectedHeight = y2 - y1 + 1;
              const xPadding = Math.max(4, Math.round(detectedWidth * 0.045));
              const topPadding = Math.max(4, Math.round(detectedHeight * 0.035));
              const bottomPadding = Math.max(8, Math.round(detectedHeight * 0.08));

              const x = Math.max(0, run.start - xPadding);
              const y = Math.max(yStart, y1 - topPadding);
              const regionWidth = Math.min(width - x, detectedWidth + xPadding * 2);
              const regionHeight = Math.min(yEnd - y + 1, detectedHeight + topPadding + bottomPadding);

              return {
                x,
                y,
                width: regionWidth,
                height: regionHeight,
              };
            });
          };

          const detectedRegions = [
            ...detectRegionsInRow(0.02, 0.50, 3),
            ...detectRegionsInRow(0.50, 0.99, 2),
          ];

          const regions =
            detectedRegions.length === 5
              ? detectedRegions
              : [
                  { x: width * 0.09, y: height * 0.075, width: width * 0.245, height: height * 0.405 },
                  { x: width * 0.3775, y: height * 0.075, width: width * 0.245, height: height * 0.405 },
                  { x: width * 0.665, y: height * 0.075, width: width * 0.245, height: height * 0.405 },
                  { x: width * 0.235, y: height * 0.555, width: width * 0.245, height: height * 0.405 },
                  { x: width * 0.52, y: height * 0.555, width: width * 0.245, height: height * 0.405 },
                ];

          const fixedCrops = await cropImageByRegions(sourceImage, regions);
          resolve(fixedCrops.slice(0, normalCardCount));
          return;
        }

        if (resolvedLayout === "vertical") {
          const regions = Array.from({ length: normalCardCount }, (_, index) => ({
            x: 0,
            y: (height / normalCardCount) * index,
            width,
            height: height / normalCardCount,
          }));

          const fixedCrops = await cropImageByRegions(sourceImage, regions);
          resolve(fixedCrops.slice(0, normalCardCount));
          return;
        }

        const fallback = await detectCardImagesFromLineupImage(sourceImage, normalCardCount);
        resolve(fallback.slice(0, normalCardCount));
      };

      image.onerror = () => resolve([]);
      image.src = sourceImage;
    });
  };

  const splitImportedGroupImage = (
    sourceImage: string,
    normalCardCount: number,
    layout: ImportImageLayout
  ) => {
    return new Promise<string[][]>((resolve) => {
      if (!sourceImage || normalCardCount <= 0) {
        resolve([]);
        return;
      }

      const image = new Image();

      image.onload = async () => {
        const width = image.width;
        const height = image.height;

        if (layout !== "grid3x2" || normalCardCount !== 2) {
          const singleMemberImages = await splitImportedMemberImage(
            sourceImage,
            normalCardCount,
            layout
          );
          resolve(singleMemberImages.length > 0 ? [singleMemberImages] : []);
          return;
        }

        // イコノイジョイ混在商品は、1枚の元画像に最大3名ぶんが横並び、
        // 各メンバーの2種が縦に並ぶ構成。
        // Volやページによってカード幅・余白が微妙に違うため、固定座標だけに頼らず、
        // まず画像内の「白背景ではない領域」から列と行を検出して切り出す。
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
          const fallbackCrops = await cropImageByRegions(sourceImage, [
            { x: width * 0.055, y: height * 0.055, width: width * 0.27, height: height * 0.42 },
            { x: width * 0.365, y: height * 0.055, width: width * 0.27, height: height * 0.42 },
            { x: width * 0.675, y: height * 0.055, width: width * 0.27, height: height * 0.42 },
            { x: width * 0.055, y: height * 0.525, width: width * 0.27, height: height * 0.42 },
            { x: width * 0.365, y: height * 0.525, width: width * 0.27, height: height * 0.42 },
            { x: width * 0.675, y: height * 0.525, width: width * 0.27, height: height * 0.42 },
          ]);

          resolve([
            [fallbackCrops[0], fallbackCrops[3]].filter(Boolean),
            [fallbackCrops[1], fallbackCrops[4]].filter(Boolean),
            [fallbackCrops[2], fallbackCrops[5]].filter(Boolean),
          ].filter((group) => group.length > 0));
          return;
        }

        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        const isContentPixel = (x: number, y: number) => {
          const index = (y * width + x) * 4;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const a = pixels[index + 3];

          if (a < 10) return false;

          // ほぼ白いページ背景だけ除外する。
          // カードの薄い水色・薄いグレー・薄いピンク部分は残したいので、判定はかなり厳しめ。
          return !(r > 252 && g > 252 && b > 252);
        };

        const buildRuns = (
          scores: number[],
          threshold: number,
          maxGap: number,
          minSize: number,
          maxSize: number
        ) => {
          const rawRuns: Array<{ start: number; end: number }> = [];
          let runStart: number | null = null;

          for (let index = 0; index < scores.length; index += 1) {
            if (scores[index] >= threshold) {
              if (runStart === null) runStart = index;
            } else if (runStart !== null) {
              rawRuns.push({ start: runStart, end: index - 1 });
              runStart = null;
            }
          }

          if (runStart !== null) {
            rawRuns.push({ start: runStart, end: scores.length - 1 });
          }

          const mergedRuns: Array<{ start: number; end: number }> = [];

          rawRuns.forEach((run) => {
            const previous = mergedRuns[mergedRuns.length - 1];

            if (previous && run.start - previous.end <= maxGap) {
              previous.end = run.end;
              return;
            }

            mergedRuns.push({ ...run });
          });

          return mergedRuns
            .map((run) => ({
              ...run,
              size: run.end - run.start + 1,
            }))
            .filter((run) => run.size >= minSize && run.size <= maxSize);
        };

        const xScores = Array.from({ length: width }, () => 0);
        const yScores = Array.from({ length: height }, () => 0);

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (!isContentPixel(x, y)) continue;
            xScores[x] += 1;
            yScores[y] += 1;
          }
        }

        const columnRuns = buildRuns(
          xScores,
          Math.max(6, Math.round(height * 0.045)),
          Math.max(6, Math.round(width * 0.025)),
          Math.round(width * 0.12),
          Math.round(width * 0.36)
        )
          .sort((a, b) => b.size - a.size)
          .slice(0, 3)
          .sort((a, b) => a.start - b.start);

        const rowRuns = buildRuns(
          yScores,
          Math.max(6, Math.round(width * 0.06)),
          Math.max(6, Math.round(height * 0.025)),
          Math.round(height * 0.20),
          Math.round(height * 0.48)
        )
          .sort((a, b) => b.size - a.size)
          .slice(0, 2)
          .sort((a, b) => a.start - b.start);

        const fallbackColumns = [
          { start: width * 0.055, end: width * 0.325 },
          { start: width * 0.365, end: width * 0.635 },
          { start: width * 0.675, end: width * 0.945 },
        ];
        const fallbackRows = [
          { start: height * 0.055, end: height * 0.475 },
          { start: height * 0.525, end: height * 0.945 },
        ];

        const columns = columnRuns.length === 3 ? columnRuns : fallbackColumns;
        const rows = rowRuns.length === 2 ? rowRuns : fallbackRows;

        const clampRegion = (column: { start: number; end: number }, row: { start: number; end: number }) => {
          const detectedWidth = column.end - column.start + 1;
          const detectedHeight = row.end - row.start + 1;

          // ほんの少し余白を足して、カード下部のロゴや細い外枠を拾う。
          // 足しすぎると隣のカードが混ざるので、通常5枚より控えめ。
          const xPadding = Math.max(3, Math.round(detectedWidth * 0.035));
          const topPadding = Math.max(3, Math.round(detectedHeight * 0.025));
          const bottomPadding = Math.max(6, Math.round(detectedHeight * 0.055));

          const sx = Math.max(0, Math.round(column.start - xPadding));
          const sy = Math.max(0, Math.round(row.start - topPadding));
          const ex = Math.min(width, Math.round(column.end + xPadding));
          const ey = Math.min(height, Math.round(row.end + bottomPadding));

          return {
            x: sx,
            y: sy,
            width: Math.max(1, ex - sx),
            height: Math.max(1, ey - sy),
          };
        };

        const regions = [
          clampRegion(columns[0], rows[0]),
          clampRegion(columns[1], rows[0]),
          clampRegion(columns[2], rows[0]),
          clampRegion(columns[0], rows[1]),
          clampRegion(columns[1], rows[1]),
          clampRegion(columns[2], rows[1]),
        ];

        const crops = await cropImageByRegions(sourceImage, regions);

        resolve([
          [crops[0], crops[3]].filter(Boolean),
          [crops[1], crops[4]].filter(Boolean),
          [crops[2], crops[5]].filter(Boolean),
        ].filter((group) => group.length > 0));
      };

      image.onerror = () => resolve([]);
      image.src = sourceImage;
    });
  };

  const applyImportedMemberImages = async (
    productId: string,
    targetMembers: Member[],
    sourceImages: string[],
    normalCardCount: number,
    importImageLayout: ImportImageLayout,
    cardCountOverrides: Record<string, number> = {}
  ) => {
    if (sourceImages.length === 0 || targetMembers.length === 0) return;

    const nextCardImages: Record<string, string> = {};
    const allCrops: string[] = [];
    const memberImageSets: string[][] = [];

    if (importImageLayout === "grid3x2") {
      const targetGroups = [...new Set(targetMembers.map((member) => member.group))] as GroupId[];

      if (targetGroups.length > 1) {
        let sourceImageIndex = 0;

        for (const group of (["equal_love", "not_equal_me", "nearly_equal_joy"] as GroupId[])) {
          const groupMemberCount = targetMembers.filter((member) => member.group === group).length;
          if (groupMemberCount === 0) continue;

          const groupSourceImageCount = Math.ceil(groupMemberCount / 3);
          const groupSourceImages = sourceImages.slice(
            sourceImageIndex,
            sourceImageIndex + groupSourceImageCount
          );
          sourceImageIndex += groupSourceImageCount;

          const groupSets: string[][] = [];

          for (const sourceImage of groupSourceImages) {
            const groups = await splitImportedGroupImage(
              sourceImage,
              normalCardCount,
              importImageLayout
            );
            groupSets.push(...groups);
          }

          memberImageSets.push(...groupSets.slice(0, groupMemberCount));
        }
      } else {
        for (const sourceImage of sourceImages) {
          const groups = await splitImportedGroupImage(
            sourceImage,
            normalCardCount,
            importImageLayout
          );
          memberImageSets.push(...groups);
        }
      }
    } else {
      for (const sourceImage of sourceImages) {
        const splitImages = await splitImportedMemberImage(
          sourceImage,
          normalCardCount,
          importImageLayout
        );
        memberImageSets.push(splitImages.slice(0, normalCardCount));
      }
    }

    for (let memberIndex = 0; memberIndex < targetMembers.length; memberIndex += 1) {
      const member = targetMembers[memberIndex];
      const memberCardCount = Math.max(1, cardCountOverrides[member.id] ?? normalCardCount);
      const cards = Array.from({ length: memberCardCount }, (_, index) => ({
        id: `card${index + 1}`,
      }));
      const imagesToApply = (memberImageSets[memberIndex] ?? []).slice(0, memberCardCount);
      allCrops.push(...imagesToApply);

      for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
        const image = imagesToApply[cardIndex];
        if (!image) continue;

        const compressedImage = await compressImageForStorage(image);
        const cardId = `${member.id}-${productId}-${cards[cardIndex].id}`;
        nextCardImages[cardId] = compressedImage;
      }
    }

    if (Object.keys(nextCardImages).length > 0) {
      setCardImages((prev) => ({
        ...prev,
        ...nextCardImages,
      }));
    }

    if (allCrops.length > 0) {
      const compressedCrops = await Promise.all(
        allCrops.map((image) => compressImageForStorage(image))
      );

      setProductCroppedImages((prev) => ({
        ...prev,
        [productId]: compressedCrops,
      }));
    }
  };

  const generateDetectedCropPreview = async (product: AppProduct) => {
    const lineupImage = productLineupImages[product.id];

    if (!lineupImage) {
      alert("先にラインナップ画像を登録してね");
      return;
    }

    const targetMembers = getProductTargetMembers(product);
    const targetCardCount = targetMembers.length * product.normalCardCount;

    if (targetCardCount <= 0) {
      alert("対象メンバーまたは通常カード数を確認してね");
      return;
    }

    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;

      const context = canvas.getContext("2d");
      if (!context) return;

      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;

      const isCardPixel = (x: number, y: number) => {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];

        // 白背景や薄い余白を除外。カード内の色・人物・文字を拾う。
        return !(r > 245 && g > 245 && b > 245);
      };

      const visited = new Uint8Array(width * height);
      const boxes: Array<{ x1: number; y1: number; x2: number; y2: number; area: number }> = [];

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const startIndex = y * width + x;

          if (visited[startIndex] || !isCardPixel(x, y)) {
            continue;
          }

          const queue: Array<[number, number]> = [[x, y]];
          visited[startIndex] = 1;

          let x1 = x;
          let y1 = y;
          let x2 = x;
          let y2 = y;
          let area = 0;

          while (queue.length > 0) {
            const [cx, cy] = queue.pop()!;
            area += 1;

            if (cx < x1) x1 = cx;
            if (cy < y1) y1 = cy;
            if (cx > x2) x2 = cx;
            if (cy > y2) y2 = cy;

            const neighbors = [
              [cx + 1, cy],
              [cx - 1, cy],
              [cx, cy + 1],
              [cx, cy - 1],
            ];

            neighbors.forEach(([nx, ny]) => {
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;

              const neighborIndex = ny * width + nx;

              if (visited[neighborIndex] || !isCardPixel(nx, ny)) return;

              visited[neighborIndex] = 1;
              queue.push([nx, ny]);
            });
          }

          const boxWidth = x2 - x1 + 1;
          const boxHeight = y2 - y1 + 1;
          const aspect = boxWidth / boxHeight;

          // ノイズ除去。カードらしい縦長矩形だけ残す。
          if (
            area > 300 &&
            boxWidth > 20 &&
            boxHeight > 35 &&
            aspect > 0.35 &&
            aspect < 0.95
          ) {
            boxes.push({ x1, y1, x2, y2, area });
          }
        }
      }

      const mergedBoxes: typeof boxes = [];

      boxes
        .sort((a, b) => b.area - a.area)
        .forEach((box) => {
          const overlaps = mergedBoxes.some((existing) => {
            const ix1 = Math.max(existing.x1, box.x1);
            const iy1 = Math.max(existing.y1, box.y1);
            const ix2 = Math.min(existing.x2, box.x2);
            const iy2 = Math.min(existing.y2, box.y2);

            if (ix2 <= ix1 || iy2 <= iy1) return false;

            const intersection = (ix2 - ix1) * (iy2 - iy1);
            const boxArea = (box.x2 - box.x1) * (box.y2 - box.y1);

            return intersection / boxArea > 0.35;
          });

          if (!overlaps) {
            mergedBoxes.push(box);
          }
        });

      const sortedBoxes = mergedBoxes
        .sort((a, b) => {
          const rowThreshold = Math.max(12, (a.y2 - a.y1) * 0.45);

          if (Math.abs(a.y1 - b.y1) > rowThreshold) {
            return a.y1 - b.y1;
          }

          return a.x1 - b.x1;
        })
        .slice(0, targetCardCount);

      if (sortedBoxes.length === 0) {
        alert("カードを検出できませんでした。等分割プレビューを試してね。");
        return;
      }

      const nextCrops = sortedBoxes.map((box) => {
        const { sx, sy, sw, sh } = getExpandedCardCropArea(box, width, height);

        const scale = 3;
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = Math.floor(sw * scale);
        cropCanvas.height = Math.floor(sh * scale);

        const cropContext = cropCanvas.getContext("2d");
        if (!cropContext) return "";

        cropContext.imageSmoothingEnabled = true;
        cropContext.imageSmoothingQuality = "high";
        cropContext.drawImage(
          canvas,
          sx,
          sy,
          sw,
          sh,
          0,
          0,
          cropCanvas.width,
          cropCanvas.height
        );

        // JPEGだとさらに粗くなるのでPNGで保持する。
        return cropCanvas.toDataURL("image/png");
      });

      setCropProductId(product.id);
      setCroppedImages(nextCrops);

      if (nextCrops.length < targetCardCount) {
        alert(
          `検出できたカードは${nextCrops.length}枚です。想定枚数${targetCardCount}枚より少ないため、切り出し結果を確認してね。`
        );
      }
    };

    image.src = lineupImage;
  };

  const generateCropPreview = async (product: AppProduct, columns: number) => {
    const lineupImage = productLineupImages[product.id];

    if (!lineupImage) {
      alert("先にラインナップ画像を登録してね");
      return;
    }

    const targetMembers = getProductTargetMembers(product);
    const targetCardCount = targetMembers.length * product.normalCardCount;

    if (targetCardCount <= 0) {
      alert("対象メンバーまたは通常カード数を確認してね");
      return;
    }

    const safeColumns = Math.max(1, columns);
    const rows = Math.ceil(targetCardCount / safeColumns);

    const image = new Image();

    image.onload = () => {
      const cellWidth = image.width / safeColumns;
      const cellHeight = image.height / rows;

      const nextCrops: string[] = [];

      for (let index = 0; index < targetCardCount; index++) {
        const col = index % safeColumns;
        const row = Math.floor(index / safeColumns);

        const scale = 3;
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(cellWidth * scale);
        canvas.height = Math.floor(cellHeight * scale);

        const context = canvas.getContext("2d");
        if (!context) continue;

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        context.drawImage(
          image,
          col * cellWidth,
          row * cellHeight,
          cellWidth,
          cellHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );

        nextCrops.push(canvas.toDataURL("image/png"));
      }

      setCropProductId(product.id);
      setCropColumns(safeColumns);
      setCroppedImages(nextCrops);
    };

    image.src = lineupImage;
  };

  const applyCroppedImages = () => {
    if (!cropProductId) return;

    const product = products.find((item) => item.id === cropProductId);
    if (!product) return;

    const targetMembers = getProductTargetMembers(product);
    const cards = createCards(product).filter((card) => !card.isSecret);

    const nextImages: Record<string, string> = {};

    let imageIndex = 0;

    targetMembers.forEach((member) => {
      cards.forEach((card) => {
        const image = croppedImages[imageIndex];

        if (image) {
          const cardId = `${member.id}-${product.id}-${card.id}`;
          nextImages[cardId] = image;
        }

        imageIndex += 1;
      });
    });

    setCardImages((prev) => ({
      ...prev,
      ...nextImages,
    }));

    alert("切り出した画像をカードへ反映しました");
  };

  const compressImageForStorage = (dataUrl: string) => {
    return new Promise<string>((resolve) => {
      const image = new Image();

      image.onload = () => {
        // 安定保存優先。localStorageの容量超過を避けるため、カード画像は軽量JPEGで保持する。
        const maxWidth = 320;
        const scale = Math.min(1, maxWidth / image.width);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        if (!context) {
          resolve(dataUrl);
          return;
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };

      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  };

  const compressMemberImageForStorage = (dataUrl: string) => {
    return new Promise<string>((resolve) => {
      const image = new Image();

      image.onload = () => {
        // メンバーアイコンは丸表示用なので正方形に切り抜いて軽量保存する。
        const maxSize = 260;
        const sourceSize = Math.min(image.width, image.height);
        const sx = Math.max(0, Math.round((image.width - sourceSize) / 2));
        const sy = Math.max(0, Math.round((image.height - sourceSize) / 2));

        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;

        const context = canvas.getContext("2d");

        if (!context) {
          resolve(dataUrl);
          return;
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(
          image,
          sx,
          sy,
          sourceSize,
          sourceSize,
          0,
          0,
          maxSize,
          maxSize
        );

        resolve(canvas.toDataURL("image/jpeg", 0.84));
      };

      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  };

  const compressLineupImageForStorage = (dataUrl: string) => {
    return new Promise<string>((resolve) => {
      const image = new Image();

      image.onload = () => {
        // ラインナップ画像は自動検出/等分割にも使うため、カード画像より大きめに残す。
        // ただし原寸保存だとlocalStorageの容量を超えやすいので上限を設ける。
        const maxWidth = 1400;
        const scale = Math.min(1, maxWidth / image.width);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        if (!context) {
          resolve(dataUrl);
          return;
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };

      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  };

  const saveCroppedImagesToProduct = async () => {
    if (!cropProductId) return;

    const compressedImages = await Promise.all(
      croppedImages.map((image) => compressImageForStorage(image))
    );

    setProductCroppedImages((prev) => ({
      ...prev,
      [cropProductId]: compressedImages,
    }));

    alert("切り出し画像をこの商品内に保存しました。各カードの枚数編集画面から個別に選べます。");
  };

  const getProductIdFromCardId = (cardId: string | null) => {
    if (!cardId) return null;
    const parts = cardId.split("-");
    return parts.length >= 3 ? parts[1] : null;
  };

  const selectCroppedImageForEditingCard = async (image: string) => {
    if (!editingCardId) return;

    const compressedImage = await compressImageForStorage(image);

    setCardImages((prev) => ({
      ...prev,
      [editingCardId]: compressedImage,
    }));
  };

  const clearProductCroppedImages = (productId: string) => {
    const shouldDelete = window.confirm("この商品の切り出し画像一覧を削除しますか？");
    if (!shouldDelete) return;

    setProductCroppedImages((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });

  };

  const uploadProductLineupImage = (productId: string, file: File | null) => {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      const compressedImage = await compressLineupImageForStorage(String(reader.result));

      setProductLineupImages((prev) => ({
        ...prev,
        [productId]: compressedImage,
      }));

    };

    reader.readAsDataURL(file);
  };

  const removeProductLineupImage = (productId: string) => {
    setProductLineupImages((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });

    setProductCroppedImages((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });

  };

  const uploadPendingProductLineupImage = (file: File | null) => {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      const compressedImage = await compressLineupImageForStorage(String(reader.result));
      setPendingProductLineupImage(compressedImage);
    };

    reader.readAsDataURL(file);
  };

  const importProductFromUrl = async () => {
    const url = productUrl.trim();

    if (!url) {
      alert("商品URLを入力してね");
      return;
    }

    setIsImportingProduct(true);

    try {
      const isLocalDev =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const apiBase = isLocalDev ? "http://localhost:3001" : "";

      const response = await fetch(
        `${apiBase}/api/import-plusmember?url=${encodeURIComponent(url)}`
      );

      if (!response.ok) {
        throw new Error("product import api failed");
      }

      const data = await response.json();

      if (data.type !== "plusmember-product-import" || !data.product) {
        alert("商品情報を取得できませんでした");
        return;
      }

      const name = String(data.product.name ?? "").trim();

      if (!name) {
        alert("商品名を取得できませんでした");
        return;
      }

      setNewProductName(name);
      setNewProductReleaseDate(
        data.product.releaseDate === "未設定" ? "" : data.product.releaseDate
      );
      setNewProductNormalCardCount(Number(data.product.normalCardCount ?? 5));
      setNewProductHasSecret(Boolean(data.product.hasSecret ?? true));
      setPendingProductLineupImage(String(data.product.lineupImage ?? ""));
      const importedMemberImages = Array.isArray(data.product.memberImages)
        ? data.product.memberImages.map((image: unknown) => String(image)).filter(Boolean)
        : [];

      setPendingProductMemberImages(importedMemberImages);
      applyAutoImportPreset(importedMemberImages, url, name);

      alert(
        `商品情報を取得しました。メンバー別画像は${Array.isArray(data.product.memberImages) ? data.product.memberImages.length : 0}枚見つかりました。取込タイプは自動設定済みです。必要なら手動で切り替えてから「商品を追加」を押してね。`
      );
    } catch {
      alert(
        "URL取込に失敗しました。ローカルではnpm run dev、公開後はFunctions/API設定を確認してね。"
      );
    } finally {
      setIsImportingProduct(false);
    }
  };

  const addProduct = async () => {
    const name = newProductName.trim();

    if (!name) {
      alert("商品名を入力してね");
      return;
    }

    const id =
      "product_" +
      name.toLowerCase().replace(/\s/g, "_").replace(/[^\wぁ-んァ-ン一-龥]/g, "") +
      "_" +
      Date.now();

    const targetMembers =
      newProductTargetMemberIds.length > 0
        ? getTargetMembers(newProductTargetGroup, newProductTargetMemberIds)
        : getTargetMembers(newProductTargetGroup, []).filter(
            (member) => !isMemberAfterGraduation(member, newProductReleaseDate)
          );

    if (targetMembers.length === 0) {
      alert("対象メンバーが選択されていません。全選択、またはメンバーを選んでね。");
      return;
    }

    const targetMemberIds = targetMembers.map((member) => member.id);
    const memberImagesToApply = getSelectedImportImages();
    const generatedMemberImageCount =
      newProductImportImageLayout === "grid3x2"
        ? memberImagesToApply.length * 3
        : memberImagesToApply.length;

    const nextCardCountOverrides = Object.fromEntries(
      targetMembers.map((member) => [
        member.id,
        Math.max(1, newProductCardCountOverrides[member.id] ?? newProductNormalCardCount),
      ])
    );

    const nextProduct: AppProduct = {
      id,
      name,
      releaseDate: newProductReleaseDate || "未設定",
      normalCardCount: Math.max(1, newProductNormalCardCount),
      hasSecret: newProductHasSecret,
      targetMemberIds,
      importedMemberImageCount: generatedMemberImageCount,
      cardCountOverrides: nextCardCountOverrides,
    };

    setProducts((prev) => [...prev, nextProduct]);

    if (pendingProductLineupImage) {
      setProductLineupImages((prev) => ({
        ...prev,
        [id]: pendingProductLineupImage,
      }));
    }

    if (pendingProductMemberImages.length > 0) {
      if (memberImagesToApply.length === 0) {
        alert("使用する画像が選択されていません。画像をタップして選択してね。");
        return;
      }

      if (generatedMemberImageCount !== targetMembers.length) {
        alert(
          `選択画像から作れるメンバー画像は${generatedMemberImageCount}人分、対象メンバーは${targetMembers.length}人です。画像選択・切り出し方式・対象メンバーのチェックを確認してね。余った画像は登録されず、足りない分は画像なしで登録します。`
        );
      }

      await applyImportedMemberImages(
        id,
        targetMembers,
        memberImagesToApply,
        Math.max(1, newProductNormalCardCount),
        newProductImportImageLayout,
        nextCardCountOverrides
      );
    }

    setProductUrl("");
    setNewProductName("");
    setNewProductReleaseDate("");
    setNewProductNormalCardCount(5);
    setNewProductHasSecret(true);
    setNewProductTargetGroup("equal_love");
    setNewProductTargetMemberIds([]);
    setNewProductCardCountOverrides({});
    setPendingProductLineupImage("");
    setPendingProductMemberImages([]);
    setSelectedImportImageIndexes([]);
    setNewProductImportImageLayout("auto");
    setImportPresetHint("");
  };

  const openProductEditor = (product: AppProduct) => {
    setEditingProductId(product.id);
    setEditingProductName(product.name);
    setEditingProductReleaseDate(product.releaseDate === "未設定" ? "" : product.releaseDate);
    setEditingProductNormalCardCount(product.normalCardCount);
    setEditingProductHasSecret(product.hasSecret);

    const targetMembers = getProductTargetMembers(product);
    const targetGroups = [...new Set(targetMembers.map((member) => member.group))];
    const firstGroup = targetMembers[0]?.group ?? "equal_love";
    setEditingProductTargetGroup(targetGroups.length > 1 ? "all_groups" : firstGroup);
    setEditingProductTargetMemberIds(product.targetMemberIds ?? targetMembers.map((member) => member.id));
  };

  const saveProductEdit = () => {
    if (!editingProductId) return;

    const name = editingProductName.trim();

    if (!name) {
      alert("商品名を入力してね");
      return;
    }

    setProducts((prev) =>
      prev.map((product) =>
        product.id === editingProductId
          ? {
              ...product,
              name,
              releaseDate: editingProductReleaseDate || "未設定",
              normalCardCount: Math.max(1, editingProductNormalCardCount),
              hasSecret: editingProductHasSecret,
              cardCountOverrides: editingProductCardCountOverrides,
              targetMemberIds:
                editingProductTargetMemberIds.length > 0
                  ? editingProductTargetMemberIds
                  : getTargetMembers(editingProductTargetGroup, []).map(
                      (member) => member.id
                    ),
            }
          : product
      )
    );

    setEditingProductId(null);
  };

  const deleteProduct = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const shouldDelete = window.confirm(
      `「${product.name}」を削除しますか？\n\nOK：商品とこの商品の所持データを削除\nキャンセル：削除しない`
    );

    if (!shouldDelete) return;

    setProducts((prev) => prev.filter((item) => item.id !== productId));

    setOwnedCounts((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cardId) => {
        if (cardId.includes(`-${productId}-`)) {
          delete next[cardId];
        }
      });
      return next;
    });

    setCardImages((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cardId) => {
        if (cardId.includes(`-${productId}-`)) {
          delete next[cardId];
        }
      });
      return next;
    });

    setProductLineupImages((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });

    setProductCroppedImages((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });

  };

  const exportBackup = async () => {
    const latestCardImages = await loadImageMap<Record<string, string>>("cardImages", cardImages);
    const latestMemberImages = await loadImageMap<Record<string, string>>("memberImages", memberImages);
    const latestProductLineupImages = await loadImageMap<Record<string, string>>("productLineupImages", productLineupImages);
    const latestProductCroppedImages = await loadImageMap<Record<string, string[]>>("productCroppedImages", productCroppedImages);

    const backupData = {
      version: 2,
      storage: "indexeddb-images",
      exportedAt: new Date().toISOString(),
      selectedMemberId,
      groupFilter,
      activeTab,
      members,
      products,
      ownedCounts,
      cardImages: latestCardImages,
      memberImages: latestMemberImages,
      productLineupImages: latestProductLineupImages,
      productCroppedImages: latestProductCroppedImages,
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateText = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `ikonoijoy-miniphoto-backup-${dateText}.json`;
    link.click();

    URL.revokeObjectURL(url);
  };

  const importBackup = (file: File | null) => {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const text = String(reader.result);
        const data = JSON.parse(text);

        if (!Array.isArray(data.members) || !Array.isArray(data.products)) {
          alert("バックアップファイルの形式が違うみたい");
          return;
        }

        const shouldImport = window.confirm(
          "バックアップを復元しますか？\n\n現在のメンバー・商品・所持データは上書きされます。"
        );

        if (!shouldImport) return;

        const nextCardImages = data.cardImages ?? {};
        const nextMemberImages = data.memberImages ?? {};
        const nextProductLineupImages = data.productLineupImages ?? {};
        const nextProductCroppedImages = data.productCroppedImages ?? {};

        await Promise.all([
          saveImageMap("cardImages", nextCardImages),
          saveImageMap("memberImages", nextMemberImages),
          saveImageMap("productLineupImages", nextProductLineupImages),
          saveImageMap("productCroppedImages", nextProductCroppedImages),
        ]);

        setMembers(data.members);
        setProducts(data.products);
        setOwnedCounts(data.ownedCounts ?? {});
        setCardImages(nextCardImages);
        setMemberImages(nextMemberImages);
        setProductLineupImages(nextProductLineupImages);
        setProductCroppedImages(nextProductCroppedImages);

        const restoredGroupFilter =
          data.groupFilter === "all" ||
          data.groupFilter === "equal_love" ||
          data.groupFilter === "not_equal_me" ||
          data.groupFilter === "nearly_equal_joy"
            ? data.groupFilter
            : "all";

        setGroupFilter(restoredGroupFilter);

        const restoredMemberId =
          typeof data.selectedMemberId === "string" &&
          data.members.some((member: Member) => member.id === data.selectedMemberId)
            ? data.selectedMemberId
            : data.members[0]?.id;

        if (restoredMemberId) {
          setSelectedMemberId(restoredMemberId);
        }

        if (
          data.activeTab === "collection" ||
          data.activeTab === "products" ||
          data.activeTab === "members" ||
          data.activeTab === "data"
        ) {
          setActiveTab(data.activeTab);
        }

        alert("復元しました。画像込みで復元できているか確認してね。");
      } catch {
        alert("バックアップファイルを読み込めませんでした");
      }
    };

    reader.readAsText(file);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${selectedGroupTheme.pale} 0%, #ffffff 45%, #fafafa 100%)`,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#111827",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompactLayout ? "1fr" : "220px minmax(0, 1fr)",
          minHeight: "100vh",
        }}
      >
        <aside
          style={{
            display: isCompactLayout ? "none" : "block",
            position: "sticky",
            top: 0,
            height: "100vh",
            padding: "24px 16px",
            background: "rgba(255,255,255,0.88)",
            borderRight: "1px solid #f3d9e8",
            boxShadow: "8px 0 30px rgba(236, 72, 153, 0.06)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              color: selectedGroupTheme.main,
              fontWeight: 900,
              fontSize: "30px",
              letterSpacing: "0.08em",
              marginBottom: "4px",
            }}
          >
            イコノイジョイ
          </div>
          <div
            style={{
              color: selectedGroupTheme.main,
              fontWeight: "bold",
              fontSize: "13px",
              marginBottom: "30px",
            }}
          >
            ミニフォトカード管理
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            <button
              onClick={() => setActiveTab("collection")}
              style={activeTab === "collection" ? sidebarActiveButtonStyle : sidebarButtonStyle}
            >
              🏠 コレクション
            </button>
            <button
              onClick={() => setActiveTab("products")}
              style={activeTab === "products" ? sidebarActiveButtonStyle : sidebarButtonStyle}
            >
              🔳 商品管理
            </button>
            <button
              onClick={() => setActiveTab("members")}
              style={activeTab === "members" ? sidebarActiveButtonStyle : sidebarButtonStyle}
            >
              👥 メンバー管理
            </button>
            <button
              onClick={() => setActiveTab("data")}
              style={activeTab === "data" ? sidebarActiveButtonStyle : sidebarButtonStyle}
            >
              💾 データ管理
            </button>
          </div>

          <div style={{ marginTop: "30px" }}>
            <SidebarSummary
              label="全体の集計"
              main={`${memberStats.ownedUniqueCards} / ${memberStats.totalCards} 枚`}
              percentage={memberStats.percentage}
            />
          </div>

          <div style={{ marginTop: "16px" }}>
            <SidebarSummary
              label="選択中メンバー"
              main={selectedMember.name}
              percentage={memberStats.percentage}
            />
          </div>
        </aside>

        <main
          style={{
            minWidth: 0,
            padding: isCompactLayout ? "14px" : "24px",
            paddingBottom: isCompactLayout ? "calc(92px + env(safe-area-inset-bottom))" : "calc(24px + env(safe-area-inset-bottom))",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: isCompactLayout ? "10px" : "16px",
              alignItems: "center",
              marginBottom: isCompactLayout ? "12px" : "18px",
              flexWrap: "wrap",
              position: isCompactLayout ? "sticky" : "static",
              top: 0,
              zIndex: 8,
              padding: isCompactLayout ? "10px 0" : 0,
              background: isCompactLayout ? "rgba(255,247,251,0.94)" : "transparent",
              backdropFilter: isCompactLayout ? "blur(12px)" : "none",
            }}
          >
            <div>
              <div style={{ color: "#6b7280", fontWeight: "bold", fontSize: "14px" }}>
                イコノイジョイミニフォトカード管理
              </div>
              <h1
                style={{
                  margin: "4px 0 0",
                  fontSize: isCompactLayout ? "34px" : "clamp(28px, 5vw, 44px)",
                  letterSpacing: "-0.05em",
                }}
              >
                {activeTab === "collection"
                  ? "コレクション"
                  : activeTab === "products"
                  ? "商品管理"
                  : activeTab === "members"
                  ? "メンバー管理"
                  : "データ管理"}
              </h1>
            </div>

            <button
              onClick={() => setActiveTab("members")}
              style={{
                ...secondaryActionButtonStyle,
                borderColor: selectedGroupTheme.main,
                color: selectedGroupTheme.main,
                borderRadius: "999px",
                padding: "10px 16px",
              }}
            >
              👥 メンバー選択
            </button>
          </div>

      <nav
        style={{
          display: isCompactLayout ? "none" : "flex",
          gap: "8px",
          flexWrap: "wrap",
          marginBottom: "20px",
          position: "sticky",
          top: 0,
          background: "rgba(255,247,251,0.92)",
          backdropFilter: "blur(12px)",
          padding: "10px 0",
          zIndex: 5,
        }}
      >
        <button
          onClick={() => setActiveTab("collection")}
          style={activeTab === "collection" ? activeTabButtonStyle : tabButtonStyle}
        >
          コレクション
        </button>
        <button
          onClick={() => setActiveTab("products")}
          style={activeTab === "products" ? activeTabButtonStyle : tabButtonStyle}
        >
          商品管理
        </button>
        <button
          onClick={() => setActiveTab("members")}
          style={activeTab === "members" ? activeTabButtonStyle : tabButtonStyle}
        >
          メンバー管理
        </button>
        <button
          onClick={() => setActiveTab("data")}
          style={activeTab === "data" ? activeTabButtonStyle : tabButtonStyle}
        >
          データ管理
        </button>
      </nav>

      {activeTab === "data" && (
      <section style={sectionStyle}>
        <h2>データ管理</h2>

        <div
          style={{
            padding: "12px",
            borderRadius: "14px",
            background: "#fff7fb",
            border: "1px solid #f3d9e8",
            color: "#374151",
            fontSize: "14px",
            fontWeight: "bold",
            marginBottom: "14px",
          }}
        >
          PWA対応：ホーム画面追加・全画面表示・オフライン起動用の設定を反映済み。画像はリロード後も残るよう安定保存寄りに調整済み。
        </div>

        <div style={{ display: "grid", gap: "12px", maxWidth: "620px" }}>
          <button onClick={exportBackup} style={primaryButtonStyle}>
            バックアップを書き出す
          </button>

          <label
            style={{
              display: "block",
              padding: "12px",
              borderRadius: "10px",
              border: "1px dashed #c084fc",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            バックアップを復元する
            <input
              type="file"
              accept="application/json"
              onChange={(event) => importBackup(event.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </label>

          <p style={{ color: "#666", fontSize: "14px", margin: 0 }}>
            PCやiPhone移行前にJSONファイルとして保存しておくと安心。
          </p>
        </div>
      </section>
      )}

      {activeTab === "products" && (
      <section style={sectionStyle}>
        <h2>商品追加</h2>

        <div style={{ display: "grid", gap: "12px", maxWidth: "520px" }}>
          <input
            value={productUrl}
            onChange={(event) => setProductUrl(event.target.value)}
            placeholder="商品URL 例：https://store.plusmember.jp/..."
            style={inputStyle}
          />

          <p style={{ color: "#666", fontSize: "13px", margin: 0 }}>
            URL取込後、商品名・発売日・メンバー別画像を確認してから、対象グループと対象メンバーを選んで追加する。画像はあいうえお順で自動割り当て。
          </p>

          <button
            onClick={importProductFromUrl}
            disabled={isImportingProduct}
            style={{
              ...secondaryActionButtonStyle,
              opacity: isImportingProduct ? 0.6 : 1,
            }}
          >
            {isImportingProduct ? "取得中..." : "URLから商品情報を取得"}
          </button>

          <input
            value={newProductName}
            onChange={(event) => setNewProductName(event.target.value)}
            placeholder="商品名 例：イコノイジョイ2023 ミニフォトカード"
            style={inputStyle}
          />

          <input
            type="date"
            value={newProductReleaseDate}
            onChange={(event) => setNewProductReleaseDate(event.target.value)}
            style={inputStyle}
          />

          {pendingProductMemberImages.length > 0 && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "12px",
                borderRadius: "12px",
                background: "#fff7fb",
                border: "1px solid #f3d9e8",
              }}
            >
              <div style={{ fontWeight: "bold" }}>取込タイプ</div>
              <p style={{ color: "#666", fontSize: "13px", margin: 0 }}>
                URL取込時に商品ページから通常商品/混在商品を自動判定する。保険として、ここで手動切り替えもできる。
              </p>
              {importPresetHint && (
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: "10px",
                    background: "white",
                    border: "1px solid #f3d9e8",
                    color: "#374151",
                    fontSize: "13px",
                    fontWeight: "bold",
                  }}
                >
                  {importPresetHint}
                </div>
              )}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={applyNormalImportPreset}
                  style={secondaryActionButtonStyle}
                >
                  通常商品（5枚×メンバー）
                </button>
                <button
                  type="button"
                  onClick={applyMixedImportPreset}
                  style={secondaryActionButtonStyle}
                >
                  混在商品（2枚×全グループ）
                </button>
              </div>
            </div>
          )}

          <label>
            通常カード数（コレクションに出す種類数）：
            <input
              type="number"
              min="1"
              value={newProductNormalCardCount}
              onChange={(event) =>
                setNewProductNormalCardCount(Number(event.target.value))
              }
              style={{
                marginLeft: "8px",
                padding: "8px",
                borderRadius: "10px",
                border: "1px solid #ddd",
                fontSize: "16px",
                width: "80px",
              }}
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={newProductHasSecret}
              onChange={(event) => setNewProductHasSecret(event.target.checked)}
            />
            シークレットあり
          </label>

          <div
            style={{
              padding: "12px",
              borderRadius: "12px",
              background: "#fafafa",
              border: "1px solid #eee",
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
              ラインナップ画像
            </div>

            <label
              style={{
                display: "block",
                padding: "10px",
                borderRadius: "10px",
                border: "1px dashed #c084fc",
                cursor: "pointer",
                textAlign: "center",
                background: "white",
                fontWeight: "bold",
              }}
            >
              {pendingProductLineupImage
                ? "ラインナップ画像を上書き"
                : "ラインナップ画像を取り込む"}
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  uploadPendingProductLineupImage(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>

            {pendingProductLineupImage && (
              <>
                <img
                  src={pendingProductLineupImage}
                  alt="取り込み予定ラインナップ画像"
                  style={{
                    width: "100%",
                    maxHeight: "360px",
                    objectFit: "contain",
                    borderRadius: "12px",
                    background: "white",
                    border: "1px solid #eee",
                    marginTop: "12px",
                  }}
                />

                <button
                  onClick={() => setPendingProductLineupImage("")}
                  style={{ ...dangerButtonStyle, marginTop: "8px" }}
                >
                  取り込み予定画像を削除
                </button>
              </>
            )}
          </div>

          <div
            style={{
              padding: "12px",
              borderRadius: "12px",
              background: "#fafafa",
              border: "1px solid #eee",
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
              対象メンバー
            </div>

            <select
              value={newProductTargetGroup}
              onChange={(event) => {
                setNewProductTargetGroup(event.target.value as ProductTargetGroup);
                setNewProductTargetMemberIds([]);
              }}
              style={{ ...inputStyle, marginBottom: "8px" }}
            >
              <option value="all_groups">全グループ</option>
              <option value="equal_love">=LOVE</option>
              <option value="not_equal_me">≠ME</option>
              <option value="nearly_equal_joy">≒JOY</option>
            </select>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={() => setNewProductTargetMemberIds(
                  getTargetMembers(newProductTargetGroup, [])
                    .filter((member) => !isMemberAfterGraduation(member, newProductReleaseDate))
                    .map((member) => member.id)
                )}
                style={secondaryActionButtonStyle}
              >
                全選択
              </button>
              <button
                type="button"
                onClick={() => setNewProductTargetMemberIds([NO_TARGET_MEMBER_SELECTION])}
                style={secondaryActionButtonStyle}
              >
                全解除
              </button>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {getTargetMembers(newProductTargetGroup, []).map((member) => {
                const checked = newProductTargetMemberIds.includes(NO_TARGET_MEMBER_SELECTION)
                  ? false
                  : newProductTargetMemberIds.length === 0
                  ? !isMemberAfterGraduation(member, newProductReleaseDate)
                  : newProductTargetMemberIds.includes(member.id);

                return (
                  <label
                    key={member.id}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: checked ? "2px solid #c084fc" : "1px solid #ddd",
                      background: checked ? "#f3e8ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        toggleTargetMember(
                          member.id,
                          newProductTargetMemberIds.length === 0 || newProductTargetMemberIds.includes(NO_TARGET_MEMBER_SELECTION)
                            ? getTargetMembers(newProductTargetGroup, [])
                                .filter((item) => !isMemberAfterGraduation(item, newProductReleaseDate))
                                .map((item) => item.id)
                            : newProductTargetMemberIds,
                          setNewProductTargetMemberIds
                        )
                      }
                      style={{ marginRight: "4px" }}
                    />
                    {member.name}
                  </label>
                );
              })}
            </div>

            <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
              <div style={{ fontWeight: "bold", color: "#374151" }}>メンバー別の種類数</div>
              <p style={{ color: "#666", fontSize: "13px", margin: 0 }}>
                基本は通常カード数と同じ。特定メンバーだけ種類数が違う商品はここで調整する。
              </p>
              {getTargetMembers(newProductTargetGroup, newProductTargetMemberIds).map((member) => (
                <label
                  key={`${member.id}-card-count`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "8px 10px",
                    borderRadius: "12px",
                    background: "white",
                    border: "1px solid #eee",
                  }}
                >
                  <span style={{ fontWeight: "bold" }}>{member.name}</span>
                  <input
                    type="number"
                    min="1"
                    value={newProductCardCountOverrides[member.id] ?? newProductNormalCardCount}
                    onChange={(event) =>
                      setNewProductCardCountOverrides((prev) => ({
                        ...prev,
                        [member.id]: Math.max(1, Number(event.target.value) || 1),
                      }))
                    }
                    style={{
                      width: "72px",
                      padding: "8px",
                      borderRadius: "10px",
                      border: "1px solid #ddd",
                      fontSize: "16px",
                    }}
                  />
                </label>
              ))}
            </div>

            <p style={{ color: "#666", fontSize: "13px", marginBottom: 0 }}>
              11人時代/10人時代などはここで対象メンバーを調整する。
            </p>
          </div>

          {pendingProductMemberImages.length > 0 && (
            <div
              style={{
                padding: "12px",
                borderRadius: "12px",
                background: "#fff7fb",
                border: "1px solid #f3d9e8",
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
                メンバー別画像：{pendingProductMemberImages.length}枚
              </div>
              <p style={{ color: "#666", fontSize: "13px", marginBottom: "10px" }}>
                画像をタップして使用する画像を選択する。混在商品は、グループごとに必要な画像だけ選択して分割登録できる。1枚の元画像に3名×縦2種が入っている商品は「3名×縦2種」を選んでね。
              </p>

              <label
                style={{
                  display: "block",
                  fontWeight: "bold",
                  color: "#374151",
                  marginBottom: "10px",
                }}
              >
                切り出し方式
                <select
                  value={newProductImportImageLayout}
                  onChange={(event) =>
                    setNewProductImportImageLayout(event.target.value as ImportImageLayout)
                  }
                  style={{ ...inputStyle, marginTop: "6px" }}
                >
                  <option value="auto">自動（5枚商品/縦2枚商品を推定）</option>
                  <option value="fixedFive">通常5枚（上3枚・下2枚）</option>
                  <option value="vertical">縦並び（1画像=1メンバー・2枚商品）</option>
                  <option value="grid3x2">3名×縦2種（1画像=3メンバー）</option>
                  <option value="detect">従来の自動検出</option>
                </select>
              </label>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  marginBottom: "10px",
                }}
              >
                <button
                  type="button"
                  onClick={selectAllImportImages}
                  style={secondaryActionButtonStyle}
                >
                  すべて選択
                </button>
                <button
                  type="button"
                  onClick={clearImportImageSelection}
                  style={secondaryActionButtonStyle}
                >
                  全解除
                </button>
              </div>

              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: "white",
                  border: "1px solid #f3d9e8",
                  color: "#6b7280",
                  fontSize: "13px",
                  marginBottom: "10px",
                }}
              >
                選択中：{selectedImportImageIndexes.length}枚 / 必要画像：
                {getRequiredImportImageCount(
                  getTargetMembers(newProductTargetGroup, newProductTargetMemberIds).length,
                  newProductImportImageLayout
                )}枚 / 作成予定：{getImportImageGeneratedMemberCount()}人分 / 対象メンバー：
                {getTargetMembers(newProductTargetGroup, newProductTargetMemberIds).length}人 / 切り出し方式：{
                  newProductImportImageLayout === "auto"
                    ? "自動"
                    : newProductImportImageLayout === "fixedFive"
                    ? "通常5枚"
                    : newProductImportImageLayout === "vertical"
                    ? "縦並び"
                    : newProductImportImageLayout === "grid3x2"
                    ? "3名×縦2種"
                    : "従来検出"
                }
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                  gap: "8px",
                }}
              >
                {pendingProductMemberImages.slice(0, 60).map((image, index) => {
                  const isSelected = selectedImportImageIndexes.includes(index);

                  return (
                    <button
                      type="button"
                      key={`${image}-${index}`}
                      onClick={() => toggleImportImageSelection(index)}
                      style={{
                        border: isSelected ? "3px solid #ff4fa3" : "1px solid #f3d9e8",
                        borderRadius: "10px",
                        overflow: "hidden",
                        background: isSelected ? "#fff0f7" : "white",
                        padding: 0,
                        cursor: "pointer",
                        position: "relative",
                        boxShadow: isSelected
                          ? "0 0 0 3px rgba(255, 79, 163, 0.16)"
                          : "none",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: "6px",
                          left: "6px",
                          zIndex: 1,
                          minWidth: "26px",
                          height: "26px",
                          borderRadius: "999px",
                          background: isSelected ? "#ff4fa3" : "rgba(255,255,255,0.9)",
                          color: isSelected ? "white" : "#6b7280",
                          display: "grid",
                          placeItems: "center",
                          fontSize: "12px",
                          fontWeight: 900,
                          border: "1px solid #f3d9e8",
                        }}
                      >
                        {index + 1}
                      </div>
                      <img
                        src={image}
                        alt={`メンバー別画像 ${index + 1}`}
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          objectFit: "contain",
                          display: "block",
                          opacity: isSelected ? 1 : 0.42,
                        }}
                      />
                      <div
                        style={{
                          padding: "4px",
                          textAlign: "center",
                          fontSize: "12px",
                          color: isSelected ? "#ff4fa3" : "#9ca3af",
                          fontWeight: "bold",
                        }}
                      >
                        {isSelected ? "選択中" : "未選択"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={addProduct} style={primaryButtonStyle}>
            商品を追加
          </button>
        </div>

        <div style={{ marginTop: "28px" }}>
          <h3>登録済み商品</h3>

          <div style={{ display: "grid", gap: "12px" }}>
            {products.map((product) => {
              const lineupImage = productLineupImages[product.id];

              return (
                <div
                  key={product.id}
                  style={{
                    padding: "14px",
                    borderRadius: "14px",
                    border: "1px solid #eee",
                    background: "#fafafa",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <strong>{product.name}</strong>
                      <div style={{ color: "#666", fontSize: "14px" }}>
                        {product.releaseDate} / 通常{product.normalCardCount}種
                        {product.hasSecret ? " + シークレット" : ""}
                      </div>
                      <div style={{ color: "#666", fontSize: "14px" }}>
                        ラインナップ画像：{lineupImage ? "登録済み" : "未登録"}
                      </div>
                      {product.importedMemberImageCount ? (
                        <div style={{ color: "#666", fontSize: "14px" }}>
                          URL取込メンバー別画像：{product.importedMemberImageCount}枚
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        onClick={() => openProductEditor(product)}
                        style={secondaryActionButtonStyle}
                      >
                        編集
                      </button>

                      <button
                        onClick={() => deleteProduct(product.id)}
                        style={dangerButtonStyle}
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <label
                      style={{
                        display: "inline-block",
                        padding: "8px 12px",
                        borderRadius: "10px",
                        border: "1px dashed #c084fc",
                        cursor: "pointer",
                        background: "white",
                        fontWeight: "bold",
                      }}
                    >
                      {lineupImage ? "ラインナップ画像を上書き" : "ラインナップ画像を登録"}
                      <input
                        key={lineupImage ? `${product.id}-has-image` : `${product.id}-no-image`}
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          uploadProductLineupImage(
                            product.id,
                            event.target.files?.[0] ?? null
                          );
                          event.currentTarget.value = "";
                        }}
                        style={{ display: "none" }}
                      />
                    </label>

                    {lineupImage && (
                      <button
                        type="button"
                        onClick={() => removeProductLineupImage(product.id)}
                        style={dangerButtonStyle}
                      >
                        ラインナップ画像を削除
                      </button>
                    )}

                    <span style={{ color: "#666", fontSize: "13px" }}>
                      自動検出プレビューと表示/非表示はコレクション画面に表示。
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {(activeTab === "collection" || activeTab === "members") && (
      <section style={sectionStyle}>
        <h2>メンバー選択</h2>

        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "16px",
          }}
        >
          {(Object.keys(groupLabels) as GroupFilter[]).map((group) => (
            <button
              key={group}
              onClick={() => handleGroupChange(group)}
              style={{
                padding: "10px 14px",
                borderRadius: "999px",
                border:
                  groupFilter === group
                    ? "2px solid #c084fc"
                    : "1px solid #ddd",
                background: groupFilter === group ? "#f3e8ff" : "white",
                cursor: "pointer",
              }}
            >
              {groupLabels[group]}
            </button>
          ))}
        </div>

        <select
          value={selectedMember?.id}
          onChange={(event) => setSelectedMemberId(event.target.value)}
          style={{ ...inputStyle, maxWidth: "360px" }}
        >
          {filteredMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>

        <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => openMemberEditor(selectedMember)}
            style={secondaryActionButtonStyle}
          >
            選択中のメンバーを編集
          </button>

          <button
            onClick={() => deleteMember(selectedMember.id)}
            style={dangerButtonStyle}
          >
            選択中のメンバーを削除
          </button>
        </div>
      </section>
      )}

      {activeTab === "members" && (
      <section style={sectionStyle}>
        <h2>メンバー追加</h2>

        <div style={{ display: "grid", gap: "12px", maxWidth: "420px" }}>
          <input
            value={newMemberName}
            onChange={(event) => setNewMemberName(event.target.value)}
            placeholder="名前 例：谷崎早耶"
            style={inputStyle}
          />

          <input
            value={newMemberKana}
            onChange={(event) => setNewMemberKana(event.target.value)}
            placeholder="よみ 例：たにざきさや"
            style={inputStyle}
          />

          <label style={{ display: "grid", gap: "6px", fontWeight: "bold", color: "#374151" }}>
            卒業日
            <input
              type="date"
              value={newMemberGraduationDate}
              onChange={(event) => setNewMemberGraduationDate(event.target.value)}
              aria-label="卒業日"
              style={inputStyle}
            />
          </label>

          <select
            value={newMemberGroup}
            onChange={(event) => setNewMemberGroup(event.target.value as GroupId)}
            style={inputStyle}
          >
            <option value="equal_love">=LOVE</option>
            <option value="not_equal_me">≠ME</option>
            <option value="nearly_equal_joy">≒JOY</option>
          </select>

          <button onClick={addMember} style={primaryButtonStyle}>
            メンバーを追加
          </button>
        </div>

        <div style={{ marginTop: "28px" }}>
          <h3>登録済みメンバー</h3>

          <div style={{ display: "grid", gap: "14px" }}>
            {(["equal_love", "not_equal_me", "nearly_equal_joy"] as GroupId[]).map(
              (group) => {
                const groupMembers = members
                  .filter((member) => member.active && member.group === group)
                  .sort((a, b) => a.kana.localeCompare(b.kana, "ja"));

                if (groupMembers.length === 0) return null;

                return (
                  <div key={group} style={{ display: "grid", gap: "12px" }}>
                    <h4
                      style={{
                        margin: "16px 0 4px",
                        padding: "8px 12px",
                        borderRadius: "999px",
                        background:
                          group === "equal_love"
                            ? "#ffe5f1"
                            : group === "not_equal_me"
                            ? "#e0f2fe"
                            : "#fef3c7",
                        color:
                          group === "equal_love"
                            ? "#db2777"
                            : group === "not_equal_me"
                            ? "#0369a1"
                            : "#92400e",
                        display: "inline-block",
                        width: "fit-content",
                      }}
                    >
                      {groupLabels[group]}
                    </h4>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isCompactLayout
                          ? "1fr"
                          : "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: "12px",
                      }}
                    >
                      {groupMembers.map((member) => (
                        <div
                          key={member.id}
                          style={{
                            padding: "14px",
                            borderRadius: "18px",
                            border: "1px solid #f1e4ec",
                            background: "white",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "14px",
                            alignItems: "center",
                            boxShadow: "0 10px 28px rgba(236, 72, 153, 0.06)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                              minWidth: 0,
                            }}
                          >
                            {renderMemberAvatar(member, 58)}
                            <div style={{ minWidth: 0 }}>
                              <strong style={{ fontSize: "18px" }}>{member.name}</strong>
                              <div style={{ color: "#666", fontSize: "14px" }}>
                                {member.kana}
                              </div>
                              <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "4px" }}>
                                {groupLabels[member.group]}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <button
                              onClick={() => {
                                setSelectedMemberId(member.id);
                                openMemberEditor(member);
                              }}
                              style={secondaryActionButtonStyle}
                            >
                              編集
                            </button>

                            <button
                              onClick={() => deleteMember(member.id)}
                              style={dangerButtonStyle}
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </section>
      )}

      {activeTab === "collection" && (
      <section style={sectionStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isCompactLayout ? "1fr" : "minmax(220px, 1fr) minmax(260px, 420px)",
            gap: "18px",
            alignItems: "center",
            marginBottom: "18px",
          }}
        >
          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            {renderMemberAvatar(selectedMember, isCompactLayout ? 72 : 88)}
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: "30px" }}>
                {selectedMember.name}
              </h2>
              <div style={{ color: "#6b7280", fontWeight: "bold" }}>
                {selectedMember.kana}
              </div>
              <div style={{ color: "#6b7280", marginTop: "6px", fontSize: "14px" }}>
                {groupLabels[selectedMember.group]}
              </div>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #f3d9e8",
              borderRadius: "18px",
              padding: "16px",
              background: "white",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "13px", fontWeight: "bold" }}>
              このメンバーのコレクション状況
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: "12px",
                marginTop: "8px",
              }}
            >
              <div style={{ fontSize: "30px", fontWeight: 900 }}>
                {memberStats.ownedUniqueCards} / {memberStats.totalCards}
                <span style={{ fontSize: "14px", marginLeft: "4px" }}>枚</span>
              </div>
              <div style={{ fontWeight: "bold" }}>{memberStats.percentage}%</div>
            </div>
            <ProgressBar percentage={memberStats.percentage} />
            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                marginTop: "12px",
                color: "#374151",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              <span>✅ 所持 {memberStats.ownedUniqueCards} 枚</span>
              <span>⚫ 未所持 {memberStats.totalCards - memberStats.ownedUniqueCards} 枚</span>
              <span>🔵 総所持 {memberStats.totalOwnedCount} 枚</span>
            </div>
          </div>
        </div>


        <div
          style={{
            height: "14px",
            background: "#f1f5f9",
            borderRadius: "999px",
            overflow: "hidden",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              width: `${memberStats.percentage}%`,
              height: "100%",
              background: "#c084fc",
              borderRadius: "999px",
              transition: "0.2s",
            }}
          />
        </div>

        {visibleProducts.map((product) => {
          const productStats = getProductStats(product);
          const cards = createCardsForMember(product, selectedMember.id);
          const lineupImage = productLineupImages[product.id];
          const savedCrops = productCroppedImages[product.id] ?? [];

          return (
            <div
              key={product.id}
              style={{
                marginTop: "18px",
                border: "1px solid #f1e4ec",
                borderRadius: "20px",
                padding: isCompactLayout ? "12px" : "18px",
                background: "rgba(255,255,255,0.92)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: "22px" }}>{product.name}</h3>
                    {productStats.ownedUniqueCards === productStats.totalCards && (
                      <span
                        style={{
                          background: "#ff4fa3",
                          color: "white",
                          borderRadius: "999px",
                          padding: "5px 12px",
                          fontWeight: "bold",
                          fontSize: "13px",
                        }}
                      >
                        コンプ！
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "8px 0 4px", color: "#6b7280" }}>
                    📅 {product.releaseDate} 発売 / 対象メンバー {getProductTargetMembers(product).length}人
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gap: "8px",
                      maxWidth: "420px",
                      marginTop: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        flexWrap: "wrap",
                        color: "#555",
                        fontSize: "14px",
                      }}
                    >
                      <span>{productStats.ownedUniqueCards} / {productStats.totalCards}種</span>
                      <span>総所持 {productStats.totalOwnedCount}枚</span>
                      <span>{productStats.percentage}%</span>
                    </div>

                    <div
                      style={{
                        height: "10px",
                        background: "#f1f5f9",
                        borderRadius: "999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${productStats.percentage}%`,
                          height: "100%",
                          background: "#c084fc",
                          borderRadius: "999px",
                          transition: "0.2s",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => openProductEditor(product)}
                    style={secondaryActionButtonStyle}
                  >
                    商品編集
                  </button>

                  <button
                    onClick={() => deleteProduct(product.id)}
                    style={dangerButtonStyle}
                  >
                    商品削除
                  </button>
                </div>
              </div>

              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "14px",
                  background: "#fafafa",
                  border: "1px solid #eee",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: lineupImage ? "12px" : 0,
                  }}
                >
                  {lineupImage && (
                    <>
                      <button
                        type="button"
                        onClick={() => generateDetectedCropPreview(product)}
                        style={secondaryActionButtonStyle}
                      >
                        自動検出プレビュー
                      </button>

                    </>
                  )}

                  <span style={{ color: "#666", fontSize: "14px" }}>
                    画像の登録・上書き・削除は「商品管理」タブから行う。ここでは確認と自動検出を使う。
                  </span>
                </div>

                {lineupImage && (
                  <details style={{ marginTop: "12px" }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        display: "inline-block",
                        padding: "8px 12px",
                        borderRadius: "10px",
                        border: "1px solid #ddd",
                        background: "white",
                        fontWeight: "bold",
                      }}
                    >
                      ラインナップ画像・切り出し画像を表示/非表示
                    </summary>

                    <img
                      src={lineupImage}
                      alt={`${product.name} ラインナップ画像`}
                      style={{
                        width: "100%",
                        maxHeight: "420px",
                        objectFit: "contain",
                        borderRadius: "12px",
                        background: "white",
                        border: "1px solid #eee",
                        marginTop: "12px",
                      }}
                    />

                    {savedCrops.length > 0 && (
                      <div
                        style={{
                          marginTop: "16px",
                          padding: "12px",
                          borderRadius: "14px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "8px",
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginBottom: "10px",
                          }}
                        >
                          <strong>切り出し画像一覧：{savedCrops.length}枚</strong>
                          <button
                            onClick={() => clearProductCroppedImages(product.id)}
                            style={dangerButtonStyle}
                          >
                            切り出し画像一覧を削除
                          </button>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
                            gap: "8px",
                          }}
                        >
                          {savedCrops.slice(0, 80).map((image, index) => (
                            <div
                              key={index}
                              style={{
                                border: "1px solid #e5e7eb",
                                borderRadius: "8px",
                                overflow: "hidden",
                                background: "white",
                              }}
                              title={`切り出し画像 ${index + 1}`}
                            >
                              <img
                                src={image}
                                alt={`saved-crop-${index + 1}`}
                                style={{
                                  width: "100%",
                                  aspectRatio: "3 / 4",
                                  objectFit: "contain",
                                  display: "block",
                                  background: "white",
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </details>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: isCompactLayout ? "20px 12px" : "28px 42px",
                  margin: isCompactLayout ? "18px auto 0" : "22px auto 0",
                  alignItems: "start",
                  overflowX: "visible",
                  paddingBottom: "10px",
                  width: "100%",
                  maxWidth: isCompactLayout ? "100%" : "760px",
                }}
              >
                {cards.map((card) => {
                  const cardId = `${selectedMember.id}-${product.id}-${card.id}`;
                  const count = ownedCounts[cardId] ?? 0;
                  const owned = count > 0;
                  const image = cardImages[cardId];

                  return (
                    <div
                      key={cardId}
                      onClick={() => handleCardClick(cardId)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openCountEditor(cardId, count);
                      }}
                      onTouchStart={() => startLongPress(cardId, count)}
                      onTouchEnd={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      style={{
                        width: "100%",
                        maxWidth: isCompactLayout ? "132px" : "180px",
                        minWidth: 0,
                        justifySelf: "center",
                        cursor: "pointer",
                        position: "relative",
                        WebkitUserSelect: "none",
                        userSelect: "none",
                        WebkitTouchCallout: "none",
                        borderRadius: isCompactLayout ? "12px" : "16px",
                      }}
                      title="右クリックまたは長押しで枚数編集"
                    >
                      {count >= 2 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "-8px",
                            right: "-8px",
                            background: "#ef4444",
                            color: "white",
                            borderRadius: "999px",
                            minWidth: "28px",
                            height: "28px",
                            padding: "0 6px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            zIndex: 1,
                          }}
                        >
                          {count}
                        </div>
                      )}

                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "3 / 4",
                          background: card.isSecret ? "#fbf4ff" : "#f7f0ff",
                          borderRadius: isCompactLayout ? "10px" : "16px",
                          border: owned
                            ? "4px solid #22c55e"
                            : card.isSecret
                            ? "2px solid #fdba74"
                            : "2px solid #d8b4fe",
                          boxShadow: owned
                            ? "0 0 0 4px rgba(34,197,94,0.18)"
                            : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: isCompactLayout ? "30px" : "clamp(34px, 4.5vw, 54px)",
                          opacity: 1,
                          transition: "0.2s",
                          overflow: "hidden",
                        }}
                      >
                        {image ? (
                          <img
                            src={image}
                            alt={card.label}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                              display: "block",
                              background: "white",
                            }}
                          />
                        ) : card.isSecret ? (
                          "?"
                        ) : (
                          "📷"
                        )}
                      </div>

                      <div style={{ textAlign: "center", marginTop: isCompactLayout ? "5px" : "8px", fontSize: isCompactLayout ? "16px" : "clamp(15px, 1.8vw, 21px)", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {card.label}
                      </div>

                      <div
                        style={{
                          textAlign: "center",
                          fontSize: isCompactLayout ? "13px" : "14px",
                          color: owned ? "#16a34a" : "#777",
                          fontWeight: owned ? "bold" : "normal",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {owned ? (isCompactLayout ? `✓${count}` : `✓ ${count}枚所持`) : (isCompactLayout ? "未" : "未所持")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
      )}

      {cropProductId && (
        <div
          onClick={() => setCropProductId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            zIndex: 20,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              width: "100%",
              maxWidth: "920px",
              maxHeight: "86vh",
              overflow: "auto",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h2>切り出しプレビュー</h2>

            <p style={{ color: "#666" }}>
              画像内のカード枠を検出し、左上から右下へ並べて切り出す。
              PNG・3倍スケールで保存するため、前より劣化しにくい。元画像が高画質なほど綺麗に残る。
              うまく検出できない場合だけ、列数を指定した等分割を試してね。
            </p>

            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: "16px",
              }}
            >
              <label>
                列数：
                <input
                  type="number"
                  min="1"
                  value={cropColumns}
                  onChange={(event) => setCropColumns(Number(event.target.value))}
                  style={{
                    marginLeft: "8px",
                    padding: "8px",
                    borderRadius: "10px",
                    border: "1px solid #ddd",
                    width: "80px",
                  }}
                />
              </label>

              <button
                onClick={() => {
                  const product = products.find((item) => item.id === cropProductId);
                  if (product) {
                    generateDetectedCropPreview(product);
                  }
                }}
                style={secondaryActionButtonStyle}
              >
                自動検出で再生成
              </button>

              <button
                onClick={() => {
                  const product = products.find((item) => item.id === cropProductId);
                  if (product) {
                    generateCropPreview(product, cropColumns);
                  }
                }}
                style={secondaryActionButtonStyle}
              >
                等分割で再生成
              </button>

              <button onClick={saveCroppedImagesToProduct} style={primaryButtonStyle}>
                切り出し画像として保存
              </button>

              <button onClick={applyCroppedImages} style={secondaryActionButtonStyle}>
                自動でカードへ反映
              </button>

              <button
                onClick={() => setCropProductId(null)}
                style={dangerButtonStyle}
              >
                閉じる
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                gap: "10px",
              }}
            >
              {croppedImages.map((image, index) => (
                <div
                  key={index}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: "10px",
                    overflow: "hidden",
                    background: "#fafafa",
                  }}
                >
                  <img
                    src={image}
                    alt={`crop-${index + 1}`}
                    style={{
                      width: "100%",
                      aspectRatio: "3 / 4",
                      objectFit: "contain",
                      display: "block",
                      background: "white",
                    }}
                  />
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: "12px",
                      padding: "4px",
                      color: "#666",
                    }}
                  >
                    {index + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingMemberId && (
        <div
          onClick={() => setEditingMemberId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            zIndex: 10,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h2>メンバー編集</h2>

            <div style={{ display: "grid", gap: "12px" }}>
              <input
                value={editingMemberName}
                onChange={(event) => setEditingMemberName(event.target.value)}
                placeholder="名前"
                style={inputStyle}
              />

              <input
                value={editingMemberKana}
                onChange={(event) => setEditingMemberKana(event.target.value)}
                placeholder="よみ"
                style={inputStyle}
              />

              <label style={{ display: "grid", gap: "6px", fontWeight: "bold", color: "#374151" }}>
                卒業日
                <input
                  type="date"
                  value={editingMemberGraduationDate}
                  onChange={(event) => setEditingMemberGraduationDate(event.target.value)}
                  aria-label="卒業日"
                  style={inputStyle}
                />
              </label>

              <select
                value={editingMemberGroup}
                onChange={(event) =>
                  setEditingMemberGroup(event.target.value as GroupId)
                }
                style={inputStyle}
              >
                <option value="equal_love">=LOVE</option>
                <option value="not_equal_me">≠ME</option>
                <option value="nearly_equal_joy">≒JOY</option>
              </select>

              {editingMemberId && (
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "14px",
                    border: "1px solid #f3d9e8",
                    background: "#fff7fb",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {renderMemberAvatar(
                      {
                        id: editingMemberId,
                        name: editingMemberName || "メ",
                        kana: editingMemberKana || "",
                        group: editingMemberGroup,
                        active: true,
                        sortOrder: 0,
                      },
                      72
                    )}
                    <div>
                      <div style={{ fontWeight: "bold" }}>メンバー画像</div>
                      <div style={{ color: "#6b7280", fontSize: "13px" }}>
                        正方形にトリミングして軽量保存します。
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <label
                      style={{
                        ...secondaryActionButtonStyle,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      画像を設定
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          uploadMemberImage(
                            editingMemberId,
                            event.target.files?.[0] ?? null
                          );
                          event.currentTarget.value = "";
                        }}
                        style={{ display: "none" }}
                      />
                    </label>

                    {memberImages[editingMemberId] && (
                      <button
                        type="button"
                        onClick={() => removeMemberImage(editingMemberId)}
                        style={dangerButtonStyle}
                      >
                        画像を削除
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setEditingMemberId(null)}
                  style={secondaryButtonStyle}
                >
                  キャンセル
                </button>

                <button onClick={saveMemberEdit} style={{ ...primaryButtonStyle, flex: 1 }}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingProductId && (
        <div
          onClick={() => setEditingProductId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            zIndex: 10,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h2>商品編集</h2>

            <div style={{ display: "grid", gap: "12px" }}>
              <input
                value={editingProductName}
                onChange={(event) => setEditingProductName(event.target.value)}
                placeholder="商品名"
                style={inputStyle}
              />

              <input
                type="date"
                value={editingProductReleaseDate}
                onChange={(event) => setEditingProductReleaseDate(event.target.value)}
                style={inputStyle}
              />

              <label>
                通常カード数：
                <input
                  type="number"
                  min="1"
                  value={editingProductNormalCardCount}
                  onChange={(event) =>
                    setEditingProductNormalCardCount(Number(event.target.value))
                  }
                  style={{
                    marginLeft: "8px",
                    padding: "8px",
                    borderRadius: "10px",
                    border: "1px solid #ddd",
                    fontSize: "16px",
                    width: "80px",
                  }}
                />
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={editingProductHasSecret}
                  onChange={(event) =>
                    setEditingProductHasSecret(event.target.checked)
                  }
                />
                シークレットあり
              </label>

              <div
                style={{
                  padding: "12px",
                  borderRadius: "12px",
                  background: "#fafafa",
                  border: "1px solid #eee",
                }}
              >
                <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
                  対象メンバー
                </div>

                <select
                  value={editingProductTargetGroup}
                  onChange={(event) => {
                    setEditingProductTargetGroup(event.target.value as ProductTargetGroup);
                    setEditingProductTargetMemberIds([]);
                  }}
                  style={{ ...inputStyle, marginBottom: "8px" }}
                >
                  <option value="equal_love">=LOVE</option>
                  <option value="not_equal_me">≠ME</option>
                  <option value="nearly_equal_joy">≒JOY</option>
                </select>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setEditingProductTargetMemberIds(
                      getTargetMembers(editingProductTargetGroup, []).map((member) => member.id)
                    )}
                    style={secondaryActionButtonStyle}
                  >
                    全選択
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingProductTargetMemberIds([NO_TARGET_MEMBER_SELECTION])}
                    style={secondaryActionButtonStyle}
                  >
                    全解除
                  </button>
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {getTargetMembers(editingProductTargetGroup, []).map((member) => {
                    const checked = editingProductTargetMemberIds.includes(NO_TARGET_MEMBER_SELECTION)
                      ? false
                      : editingProductTargetMemberIds.length === 0 ||
                        editingProductTargetMemberIds.includes(member.id);

                    return (
                      <label
                        key={member.id}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: checked
                            ? "2px solid #c084fc"
                            : "1px solid #ddd",
                          background: checked ? "#f3e8ff" : "white",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            toggleTargetMember(
                              member.id,
                              editingProductTargetMemberIds.length === 0
                                ? getTargetMembers(
                                    editingProductTargetGroup,
                                    []
                                  ).map((item) => item.id)
                                : editingProductTargetMemberIds,
                              setEditingProductTargetMemberIds
                            )
                          }
                          style={{ marginRight: "4px" }}
                        />
                        {member.name}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setEditingProductId(null)}
                  style={secondaryButtonStyle}
                >
                  キャンセル
                </button>

                <button onClick={saveProductEdit} style={{ ...primaryButtonStyle, flex: 1 }}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingCardId && (
        <div
          onClick={() => setEditingCardId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              width: "100%",
              maxWidth: "360px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h2>所持枚数</h2>

            <input
              type="number"
              min="0"
              value={editingCount}
              onChange={(event) => setEditingCount(Number(event.target.value))}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid #ddd",
                fontSize: "20px",
                marginBottom: "16px",
              }}
            />

            {editingCardId &&
              productCroppedImages[getProductIdFromCardId(editingCardId) ?? ""]?.length > 0 && (
                <div
                  style={{
                    marginBottom: "16px",
                    padding: "12px",
                    borderRadius: "12px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
                    切り出し画像から選ぶ
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: "8px",
                      maxHeight: "220px",
                      overflow: "auto",
                    }}
                  >
                    {productCroppedImages[
                      getProductIdFromCardId(editingCardId) ?? ""
                    ].map((image, index) => (
                      <button
                        key={index}
                        onClick={() => selectCroppedImageForEditingCard(image)}
                        style={{
                          padding: 0,
                          border: "1px solid #ddd",
                          borderRadius: "8px",
                          overflow: "hidden",
                          background: "white",
                          cursor: "pointer",
                        }}
                        title={`切り出し画像 ${index + 1}`}
                      >
                        <img
                          src={image}
                          alt={`crop-choice-${index + 1}`}
                          style={{
                            width: "100%",
                            aspectRatio: "3 / 4",
                            objectFit: "contain",
                            display: "block",
                            background: "white",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

            <div
              style={{
                display: "grid",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <label
                style={{
                  display: "block",
                  padding: "10px",
                  borderRadius: "10px",
                  border: "1px dashed #c084fc",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                画像を登録・変更
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => uploadCardImage(event.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />
              </label>

              {editingCardId && cardImages[editingCardId] && (
                <button
                  onClick={removeCardImage}
                  style={dangerButtonStyle}
                >
                  画像を削除
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setEditingCount((prev) => Math.max(0, prev - 1))}
                style={secondaryButtonStyle}
              >
                -1
              </button>

              <button
                onClick={() => setEditingCount((prev) => prev + 1)}
                style={secondaryButtonStyle}
              >
                +1
              </button>
            </div>

            <button onClick={saveCount} style={{ ...primaryButtonStyle, width: "100%", marginTop: "16px" }}>
              保存
            </button>
          </div>
        </div>
      )}


          {isCompactLayout && (
            <nav
              style={{
                position: "fixed",
                left: "12px",
                right: "12px",
                bottom: "calc(10px + env(safe-area-inset-bottom))",
                zIndex: 20,
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "6px",
                padding: "8px",
                borderRadius: "24px",
                background: "rgba(255,255,255,0.94)",
                border: "1px solid #f3d9e8",
                boxShadow: "0 12px 32px rgba(236, 72, 153, 0.18)",
                backdropFilter: "blur(16px)",
              }}
            >
              <button onClick={() => setActiveTab("collection")} style={activeTab === "collection" ? mobileNavActiveButtonStyle : mobileNavButtonStyle}>
                🏠<br />一覧
              </button>
              <button onClick={() => setActiveTab("products")} style={activeTab === "products" ? mobileNavActiveButtonStyle : mobileNavButtonStyle}>
                🔳<br />商品
              </button>
              <button onClick={() => setActiveTab("members")} style={activeTab === "members" ? mobileNavActiveButtonStyle : mobileNavButtonStyle}>
                👥<br />メンバー
              </button>
              <button onClick={() => setActiveTab("data")} style={activeTab === "data" ? mobileNavActiveButtonStyle : mobileNavButtonStyle}>
                💾<br />データ
              </button>
            </nav>
          )}
        </main>
      </div>
    </div>
  );
}

function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div
      style={{
        height: "8px",
        background: "#f5dce8",
        borderRadius: "999px",
        overflow: "hidden",
        marginTop: "10px",
      }}
    >
      <div
        style={{
          width: `${percentage}%`,
          height: "100%",
          background: "#ff4fa3",
          borderRadius: "999px",
          transition: "0.2s",
        }}
      />
    </div>
  );
}

function SidebarSummary({
  label,
  main,
  percentage,
}: {
  label: string;
  main: string;
  percentage: number;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #f3d9e8",
        borderRadius: "16px",
        padding: "14px",
      }}
    >
      <div style={{ fontSize: "13px", color: "#6b7280", fontWeight: "bold" }}>
        {label}
      </div>
      <div style={{ fontSize: "18px", fontWeight: 900, marginTop: "8px" }}>
        {main}
      </div>
      <ProgressBar percentage={percentage} />
    </div>
  );
}

const sectionStyle = {
  background: "rgba(255,255,255,0.94)",
  borderRadius: "22px",
  padding: "22px",
  boxShadow: "0 14px 42px rgba(236, 72, 153, 0.08)",
  border: "1px solid #f3d9e8",
  marginBottom: "20px",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid #e5e7eb",
  background: "white",
  fontSize: "16px",
  outlineColor: "#ff4fa3",
};

const primaryButtonStyle = {
  padding: "12px 14px",
  borderRadius: "999px",
  border: "none",
  background: "#ff4fa3",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(255,79,163,0.22)",
};

const tabButtonStyle = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid #f3d9e8",
  background: "white",
  color: "#374151",
  fontWeight: "bold",
  cursor: "pointer",
};

const activeTabButtonStyle = {
  ...tabButtonStyle,
  border: "1px solid #ff4fa3",
  background: "#fff0f7",
  color: "#ff4fa3",
};

const secondaryButtonStyle = {
  flex: 1,
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #ddd",
  background: "white",
};

const secondaryActionButtonStyle = {
  padding: "8px 12px",
  borderRadius: "12px",
  border: "1px solid #f3d9e8",
  background: "white",
  color: "#374151",
  cursor: "pointer",
  fontWeight: "bold",
};

const dangerButtonStyle = {
  padding: "8px 12px",
  borderRadius: "12px",
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#be123c",
  cursor: "pointer",
  fontWeight: "bold",
};


const sidebarButtonStyle = {
  width: "100%",
  textAlign: "left" as const,
  padding: "12px 14px",
  borderRadius: "12px",
  border: "none",
  background: "transparent",
  color: "#111827",
  fontWeight: "bold",
  cursor: "pointer",
};

const sidebarActiveButtonStyle = {
  ...sidebarButtonStyle,
  background: "#ffe5f1",
  color: "#ff4fa3",
};

const mobileNavButtonStyle = {
  border: "none",
  borderRadius: "16px",
  background: "transparent",
  color: "#6b7280",
  fontWeight: "bold",
  fontSize: "12px",
  lineHeight: 1.35,
  padding: "8px 4px",
  cursor: "pointer",
};

const mobileNavActiveButtonStyle = {
  ...mobileNavButtonStyle,
  background: "#ffe5f1",
  color: "#ff4fa3",
};

export default App;
