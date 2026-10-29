
export type RecommendationStatus = "PENDING" | "READY" | "FAILED";
export type ClassClipStatus = "PENDING" | "READY" | "SKIPPED";

export type NewRecommendation = {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number | null;
  rank: number;
  score: number | null;
};

export type RecommendationRow = NewRecommendation & { id: number };

export type NewClassClip = {
  anchorParagraph: number;
  videoId: string;
  title: string;
  channel: string;
  startSeconds: number;
  endSeconds: number;
  transcriptExcerpt: string | null;
  concept: string;
};

export type ClassClipRow = NewClassClip & { id: number };

export type VideoAssetRow = {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number | null;
  /** Parsed transcript segments, null when never fetched. */
  transcript: Array<{ startSeconds: number; endSeconds: number | null; text: string }> | null;
};

/**
 * Persistence for the video-enrichment subsystem. Lives beside the learning
 * repos (recommendations belong to Skill, clips to Class) but the columns are
 * owned here — the learning module never reads them.
 */
export type VideoRepository = {
  // ---- recommendations (skill-level) ----
  /** Lease stale PENDING skills for regeneration; bumps the attempt counter. */
  claimStaleRecommendationSkills(
    olderThan: Date,
  ): Promise<Array<{ id: number; topic: string }>>;
  getRecommendationsState(
    skillId: number,
  ): Promise<{ status: RecommendationStatus | null; attempts: number }>;
  findClassClips(classId: number): Promise<ClassClipRow[]>;
  /** Clip gate for the lesson screen: status plus the ready clips. */
  getClassClipState(
    classId: number,
  ): Promise<{ clipStatus: ClassClipStatus; clips: ClassClipRow[] }>;
  findSkillTopic(skillId: number): Promise<string | null>;
  /**
   * The language the skill's lessons teach in — the AI-decided baseLanguage
   * of the latest lesson (BCP-47), null before lesson 0 exists. Drives the
   * video pipelines' language gate.
   */
  findSkillLanguage(skillId: number): Promise<string | null>;
  findSkillOwner(skillId: number): Promise<number | null>;
  setRecommendationsStatus(skillId: number, status: RecommendationStatus): Promise<void>;
  replaceRecommendations(skillId: number, items: NewRecommendation[]): Promise<void>;
  findRecommendations(skillId: number): Promise<RecommendationRow[]>;

  // ---- clips (class-level) ----
  /** Terminal give-up: too many failed attempts flips the class to SKIPPED. */
  failStaleClipClasses(maxAttempts: number): Promise<void>;
  /** Lease one generation window; bumps clipAttempts. */
  claimStaleClipClasses(olderThan: Date): Promise<Array<{ id: number; skillId: number }>>;
  setClipStatus(classId: number, status: ClassClipStatus): Promise<void>;
  findClassForClips(
    classId: number,
  ): Promise<{
    id: number;
    title: string;
    contentMd: string;
    skillTopic: string;
    baseLanguage: string | null;
  } | null>;
  replaceClassClips(classId: number, clips: NewClassClip[]): Promise<void>;
  findClassClips(classId: number): Promise<ClassClipRow[]>;

  // ---- shared video asset cache ----
  findVideoAsset(videoId: string): Promise<VideoAssetRow | null>;
  upsertVideoAsset(asset: {
    videoId: string;
    title: string;
    channel: string;
    durationSeconds: number | null;
  }): Promise<void>;
};
