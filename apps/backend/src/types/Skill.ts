export interface Skill {
  skillId: string;
  topic: string;
  latestClass: {
    title: string;
    content: string;
  };
}
