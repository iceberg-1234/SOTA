export interface KoreanMedicinePouchInfo {
  patientName?: string;
  pharmacyName?: string;
  timingSlot: "아침 식후" | "점심 식후" | "저녁 식후" | "취침 전" | "점안액(수시)";
  purposeSummary: string;
  caution?: string;
}

export interface KoreanFoodExpiryInfo {
  productName: string;
  expiryDateIso: string;
  referenceTodayIso?: string;
  containerPositionHint?: string;
}

export interface KoreanParcelLabelInfo {
  recipientName: string;
  senderOrShopName: string;
  itemSummary: string;
}

export interface GroceryProductComparisonInfo {
  productName: string;
  variantOrFlavor: string;
  isZeroSugar?: boolean;
  priceWon: number;
  promotionBadge?: "1+1" | "2+1" | "할인행사" | "일반";
}

export interface DiningPlateItem {
  positionKo: "앞쪽 왼쪽" | "앞쪽 오른쪽" | "가운데" | "위쪽 왼쪽" | "위쪽 가운데" | "위쪽 오른쪽";
  foodName: string;
  remainingNote?: string;
  hasBoneOrThorns?: boolean;
}

export interface ApplianceStatusInfo {
  applianceType: "인덕션" | "세탁기" | "전자레인지" | "에어컨";
  activeCourseOrZone: string;
  powerLevelOrTemp?: string;
  remainingMinutes?: number;
  hasResidualHeatWarning?: boolean;
}

export interface RestroomGuideInfo {
  entranceGenderKo: "남자 화장실" | "여자 화장실" | "남녀공용·장애인 화장실";
  entranceDirectionKo: string;
  availableStallOrder?: number;
  occupiedStallOrders?: number[];
  sinkLocationKo?: string;
}

export interface SocialOrMeetingCueInfo {
  cueType: "HANDING_OBJECT" | "HANDSHAKE" | "PRESENTATION_SLIDE";
  personOrSlideTitle: string;
  detailOrActionKo: string;
}

export class KoreanSmartReader {
  summarizeMedicine(info: KoreanMedicinePouchInfo): string {
    const cautionText = info.caution ? ` 주의사항: ${info.caution}.` : "";
    return `${info.timingSlot}에 복용하는 ${info.purposeSummary} 약입니다.${cautionText}`;
  }

  summarizeFoodExpiry(info: KoreanFoodExpiryInfo): {
    isExpired: boolean;
    daysRemaining: number;
    spokenKorean: string;
  } {
    const today = new Date(info.referenceTodayIso ?? "2026-11-15T00:00:00Z");
    const expiry = new Date(`${info.expiryDateIso}T00:00:00Z`);
    const diffDays = Math.round(
      (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    const [, monthStr, dayStr] = info.expiryDateIso.split("-");
    const dateKo = `${Number(monthStr)}월 ${Number(dayStr)}일`;
    const posPrefix = info.containerPositionHint
      ? `${info.containerPositionHint}에 있는 `
      : "";

    if (diffDays < 0) {
      return {
        isExpired: true,
        daysRemaining: diffDays,
        spokenKorean: `주의하세요. ${posPrefix}${info.productName} 소비기한이 ${dateKo}까지로 ${Math.abs(diffDays)}일 지났습니다. 드시지 마세요.`,
      };
    }

    if (diffDays === 0) {
      return {
        isExpired: false,
        daysRemaining: 0,
        spokenKorean: `${posPrefix}${info.productName} 소비기한이 오늘(${dateKo})까지입니다.`,
      };
    }

    return {
      isExpired: false,
      daysRemaining: diffDays,
      spokenKorean: `${posPrefix}${info.productName}입니다. 소비기한은 ${dateKo}까지로 ${diffDays}일 남았습니다.`,
    };
  }

  summarizeParcelLabel(info: KoreanParcelLabelInfo): string {
    return `${info.recipientName}님 앞으로 온 ${info.senderOrShopName} 택배입니다. 품목은 ${info.itemSummary}입니다.`;
  }

  /**
   * UC-16: Distinguishes identical-feeling cans/bottles/packages in convenience stores or supermarkets.
   */
  summarizeGroceryProductKo(info: GroceryProductComparisonInfo): string {
    const zeroTag = info.isZeroSugar ? " 제로슈거" : "";
    const promo =
      info.promotionBadge && info.promotionBadge !== "일반"
        ? ` 현재 ${info.promotionBadge} 행사 상품이라 더 챙기실 수 있어요.`
        : "";
    return `지금 드신 상품은 ${info.productName} ${info.variantOrFlavor}${zeroTag}이고, 가격은 ${info.priceWon.toLocaleString("ko-KR")}원이에요.${promo}`;
  }

  /**
   * UC-17: Describes food/side-dish positions on a plate or tray (including white-on-white foods and fish bone warnings).
   */
  describeDiningPlateLayoutKo(items: readonly DiningPlateItem[]): string {
    if (items.length === 0) return "접시 위에 음식이 보이지 않아요.";
    const parts = items.map((it) => {
      const rem = it.remainingNote ? `(${it.remainingNote})` : "";
      const bone = it.hasBoneOrThorns ? " 가시나 뼈가 있으니 주의하세요" : "";
      return `${it.positionKo}에 ${it.foodName}${rem}${bone}`;
    });
    return `식사 배치를 알려드릴게요. ${parts.join(", ")}가 놓여 있어요.`;
  }

  /**
   * UC-20: Reads flat induction stove burners (including residual heat 'H' burn hazards) and appliance LED displays.
   */
  summarizeAppliancePanelKo(info: ApplianceStatusInfo): string {
    if (info.applianceType === "인덕션") {
      const heatWarn = info.hasResidualHeatWarning
        ? " 옆 화구에 잔열 표시가 떠서 뜨거우니 절대 손을 대지 마세요."
        : "";
      return `인덕션 ${info.activeCourseOrZone} 화구가 현재 ${info.powerLevelOrTemp ?? "켜짐"} 상태예요.${heatWarn}`;
    }
    const minText =
      info.remainingMinutes !== undefined
        ? `, 남은 시간은 약 ${info.remainingMinutes}분이에요.`
        : "로 설정되어 있어요.";
    return `${info.applianceType} 현재 ${info.activeCourseOrZone} 코스${minText}`;
  }

  /**
   * UC-21: Guides through public restroom gender pictograms, vacant/occupied stalls, and sink locations.
   */
  describeRestroomAndStallKo(info: RestroomGuideInfo): string {
    const stallText =
      info.availableStallOrder !== undefined
        ? ` 안쪽으로 들어가시면 ${info.availableStallOrder}번째 칸 문이 비어 있어요.`
        : "";
    const sinkText = info.sinkLocationKo
      ? ` 세면대는 ${info.sinkLocationKo}에 있어요.`
      : "";
    return `${info.entranceDirectionKo} 문이 ${info.entranceGenderKo}이에요.${stallText}${sinkText}`;
  }

  /**
   * UC-22: Coaches non-verbal social cues (handing a business card/cup, handshake) and meeting slide summaries.
   */
  coachSocialAndMeetingCueKo(info: SocialOrMeetingCueInfo): string {
    if (info.cueType === "PRESENTATION_SLIDE") {
      return `지금 회의 화면 슬라이드는 ${info.personOrSlideTitle} 내용이고, 핵심은 ${info.detailOrActionKo}이에요.`;
    }
    return `앞에 계신 ${info.personOrSlideTitle}님이 ${info.detailOrActionKo} 있어요. 정면 가슴 높이로 손을 뻗어 보실래요?`;
  }
}
