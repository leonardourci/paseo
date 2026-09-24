import { describe, expect, it } from "vitest";
import type { UserComposerAttachment } from "@/attachments/types";
import type { StreamItem } from "@/types/stream";
import { parseOutputComments, withOutputComments } from "./fence";
import type { PendingOutputComment } from "./store";
import {
  heldImageIds,
  placeQueuedText,
  prepareOutgoingText,
  restoreOutgoingText,
  sendableComments,
  withCommentImages,
} from "./send";

const noted: PendingOutputComment = {
  id: "c1",
  sourceItemId: "a1",
  startBlock: 1,
  endBlock: 1,
  quote: "beta",
  occurrence: 0,
  isCode: false,
  note: "why?",
  imageIds: [],
};
const blank: PendingOutputComment = {
  id: "c2",
  sourceItemId: "a1",
  startBlock: 2,
  endBlock: 2,
  quote: "gamma",
  occurrence: 0,
  isCode: false,
  note: "  \n",
  imageIds: [],
};
const pending = [noted, blank];
const FENCED = "```paseo-comment block=1\n> beta\n\nwhy?\n```";

describe("sendableComments", () => {
  it("keeps only the comments that would be sent", () => {
    const imageOnly = { ...blank, id: "c3", imageIds: ["shot"] };
    expect(
      sendableComments({ pending: [noted, blank, imageOnly], imageIds: [], loaded: undefined }),
    ).toEqual([noted]);
    expect(
      sendableComments({
        pending: [noted, blank, imageOnly],
        imageIds: ["shot"],
        loaded: undefined,
      }),
    ).toEqual([noted, imageOnly]);
  });

  it("leaves out comments on output that isn't loaded until it loads again", () => {
    const older = { ...noted, id: "c3", sourceItemId: "older" };
    expect(sendableComments({ pending: [noted, older], imageIds: [], loaded: ["a1"] })).toEqual([
      noted,
    ]);
    expect(
      sendableComments({ pending: [noted, older], imageIds: [], loaded: ["a1", "older"] }),
    ).toEqual([noted, older]);
    expect(sendableComments({ pending: [noted, older], imageIds: [], loaded: [] })).toEqual([]);
  });
});

describe("prepareOutgoingText", () => {
  it("appends the fences and reports the comments with the notes sent", () => {
    expect(
      prepareOutgoingText({ text: "reply", pending: [noted], imageIds: [], loaded: undefined }),
    ).toEqual({
      text: `reply\n\n${FENCED}`,
      sent: [{ id: "c1", note: "why?" }],
    });
  });

  it("leaves blank comments out of the text but still reports them", () => {
    expect(
      prepareOutgoingText({ text: "reply", pending, imageIds: [], loaded: undefined }),
    ).toEqual({
      text: `reply\n\n${FENCED}`,
      sent: [
        { id: "c1", note: "why?" },
        { id: "c2", note: "  \n" },
      ],
    });
  });

  it("leaves the text alone with no pending comments", () => {
    expect(
      prepareOutgoingText({ text: "reply", pending: [], imageIds: [], loaded: undefined }),
    ).toEqual({ text: "reply", sent: [] });
  });

  it("keeps the comments pending when the message is a slash command", () => {
    expect(
      prepareOutgoingText({
        text: "  /compact now",
        pending: [noted],
        imageIds: [],
        loaded: undefined,
      }),
    ).toEqual({
      text: "  /compact now",
      sent: [],
    });
  });

  it("sends and reports only the comments on loaded output", () => {
    const older = { ...noted, id: "c3", sourceItemId: "older", note: "held" };
    expect(
      prepareOutgoingText({ text: "reply", pending: [noted, older], imageIds: [], loaded: ["a1"] }),
    ).toEqual({
      text: "reply\n\n```paseo-comment block=1 msg=1\n> beta\n\nwhy?\n```",
      sent: [{ id: "c1", note: "why?" }],
      lastOutputId: "a1",
    });
  });

  it("numbers each comment's output back from the newest, which the message follows", () => {
    const earlier = { ...noted, id: "c3", sourceItemId: "a0", note: "earlier" };
    const prepared = prepareOutgoingText({
      text: "",
      pending: [noted, earlier],
      imageIds: [],
      loaded: ["a0", "a1", "a2"],
    });
    expect(parseOutputComments(prepared.text).comments.map((c) => c.messageOrdinal)).toEqual([
      2, 3,
    ]);
    expect(prepared.lastOutputId).toBe("a2");
  });

  it("marks each image by its position among the sent images, in position order", () => {
    const withImages = { ...noted, imageIds: ["late", "early"] };
    expect(
      prepareOutgoingText({
        text: "",
        pending: [withImages],
        imageIds: ["other", "early", "late"],
        loaded: undefined,
      }).text,
    ).toBe("```paseo-comment block=1\n> beta\n\nwhy?\n[Image 2] [Image 3]\n```");
  });

  it("drops images that are not sent", () => {
    const withImages = { ...noted, imageIds: ["gone", "kept"] };
    expect(
      prepareOutgoingText({
        text: "",
        pending: [withImages],
        imageIds: ["kept"],
        loaded: undefined,
      }).text,
    ).toBe("```paseo-comment block=1\n> beta\n\nwhy?\n[Image 1]\n```");
  });

  it.each([
    [
      "sends a blank note that has a sent image",
      ["shot"],
      "reply\n\n```paseo-comment block=2\n> gamma\n\n[Image 1]\n```",
    ],
    ["leaves out a blank note whose images are all gone", ["other"], "reply"],
  ])("%s", (_, imageIds, text) => {
    const imageOnly = { ...blank, imageIds: ["shot"] };
    expect(
      prepareOutgoingText({ text: "reply", pending: [imageOnly], imageIds, loaded: undefined }),
    ).toEqual({ text, sent: [{ id: "c2", note: "  \n" }] });
  });
});

describe("restoreOutgoingText", () => {
  const items: StreamItem[] = [
    {
      kind: "assistant_message",
      id: "a1",
      text: "Alpha.\n\nThe beta line.",
      timestamp: new Date(0),
    },
  ];

  it("gives back the typed text and the comments, aimed at the output", () => {
    const withImage = { ...noted, imageIds: ["shot"] };
    const { text } = prepareOutgoingText({
      text: "reply\n\n\nmore",
      pending: [withImage],
      imageIds: ["other", "shot"],
      loaded: undefined,
    });
    const restored = restoreOutgoingText({
      items,
      text,
      imageIds: ["other", "shot"],
      lastOutputId: undefined,
    });
    expect(restored.text).toBe("reply\n\n\nmore");
    expect(restored.comments).toEqual([{ ...withImage, id: expect.any(String) }]);
  });

  it("drops image markers whose images did not come back", () => {
    const withImage = { ...noted, imageIds: ["shot"] };
    const { text } = prepareOutgoingText({
      text: "",
      pending: [withImage],
      imageIds: ["shot"],
      loaded: undefined,
    });
    expect(
      restoreOutgoingText({ items, text, imageIds: [], lastOutputId: undefined }).comments,
    ).toEqual([{ ...noted, id: expect.any(String) }]);
  });

  it("keeps the list item a comment ends in only while it stays on the block it named", () => {
    const inItem = { ...noted, endItem: [0] };
    const restoredItem = (sent: PendingOutputComment) => {
      const { text } = prepareOutgoingText({
        text: "",
        pending: [sent],
        imageIds: [],
        loaded: undefined,
      });
      return restoreOutgoingText({ items, text, imageIds: [], lastOutputId: undefined }).comments[0]
        ?.endItem;
    };
    expect(restoredItem(inItem)).toEqual([0]);
    expect(restoredItem({ ...inItem, startBlock: 0, endBlock: 0 })).toBeUndefined();
  });

  it("keeps a comment whose output is gone in the text", () => {
    const text = withOutputComments("reply", [
      { quote: "absent", note: "n", startBlock: 0, occurrence: 0, isCode: false },
    ]);
    expect(restoreOutgoingText({ items, text, imageIds: [], lastOutputId: undefined })).toEqual({
      text,
      comments: [],
    });
  });
});

describe("restoring a repeated quote", () => {
  const repeated: StreamItem[] = ["a1", "a2", "a3"].map((id) => ({
    kind: "assistant_message",
    id,
    text: "Alpha.\n\nThe beta line.",
    timestamp: new Date(0),
  }));

  function restoredSource(text: string, lastOutputId?: string): string | undefined {
    return restoreOutgoingText({ items: repeated, text, imageIds: [], lastOutputId }).comments[0]
      ?.sourceItemId;
  }

  it("aims each comment at the message its ordinal names, not the latest with the quote", () => {
    const { text } = prepareOutgoingText({
      text: "",
      pending: [noted],
      imageIds: [],
      loaded: ["a1", "a2", "a3"],
    });
    expect(restoredSource(text)).toBe("a1");
  });

  it("counts a queued message's ordinals back from where it was queued", () => {
    const { text } = prepareOutgoingText({
      text: "",
      pending: [{ ...noted, sourceItemId: "a2" }],
      imageIds: [],
      loaded: ["a1", "a2"],
    });
    expect(restoredSource(text, "a2")).toBe("a2");
    expect(restoredSource(text, "gone")).toBe("a3");
  });
});

describe("heldImageIds", () => {
  const held = { ...noted, id: "c3", sourceItemId: "older", imageIds: ["mine", "shared"] };
  const sent = { ...noted, imageIds: ["shared"] };

  it("holds the images only comments staying pending use", () => {
    expect(heldImageIds({ text: "reply", pending: [sent, held], loaded: ["a1"] })).toEqual([
      "mine",
    ]);
  });

  it("holds every comment's images when a slash command leaves them all pending", () => {
    expect(heldImageIds({ text: "/compact", pending: [sent, held], loaded: ["a1"] })).toEqual([
      "shared",
      "mine",
      "shared",
    ]);
  });
});

describe("placeQueuedText", () => {
  const output: StreamItem[] = ["a1", "a2", "a3"].map((id) => ({
    kind: "assistant_message",
    id,
    text: "The beta line.",
    timestamp: new Date(0),
  }));
  const { text: queued } = prepareOutgoingText({
    text: "reply",
    pending: [noted],
    imageIds: [],
    loaded: ["a1"],
  });

  it("moves the ordinals back past output written after the message was queued", () => {
    expect(placeQueuedText({ items: output, text: queued, lastOutputId: "a1" })).toBe(
      "reply\n\n```paseo-comment block=1 msg=3\n> beta\n\nwhy?\n```",
    );
  });

  it("leaves the text alone when nothing was written since", () => {
    expect(placeQueuedText({ items: output.slice(0, 1), text: queued, lastOutputId: "a1" })).toBe(
      queued,
    );
  });

  it("drops the ordinals once the output it was queued behind is gone", () => {
    expect(placeQueuedText({ items: output, text: queued, lastOutputId: "gone" })).toBe(
      `reply\n\n${FENCED}`,
    );
  });
});

describe("withCommentImages", () => {
  function image(id: string): UserComposerAttachment {
    return {
      kind: "image",
      metadata: {
        id,
        mimeType: "image/png",
        storageType: "web-indexeddb",
        storageKey: id,
        createdAt: 0,
      },
    };
  }
  const draft = [image("mine"), image("loose"), image("sent")];

  it("keeps the draft's images a pending comment uses, once each", () => {
    const withMine = { ...noted, imageIds: ["mine"] };
    expect(withCommentImages({ attachments: [], draft, pending: [withMine] })).toEqual([
      image("mine"),
    ]);
    expect(withCommentImages({ attachments: [image("mine")], draft, pending: [withMine] })).toEqual(
      [image("mine")],
    );
  });

  it("drops the images no pending comment uses", () => {
    expect(withCommentImages({ attachments: [], draft, pending })).toEqual([]);
  });
});
