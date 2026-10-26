import test from "node:test";
import assert from "node:assert/strict";
import { navigateApplication } from "./title-screen-navigation.mjs";
test("navigation discovery survives a replaced link list and clicks the visible matching router link", async () => {
  let current = "http://127.0.0.1:8080/market", clicked = 0, snapshots = 0;
  const href = "/features/downtime?from=market";
  const page = {
    url: () => current,
    locator(selector) {
      if (selector === "a[href]") return {
        count: async () => 34,
        nth: () => ({ isVisible:async()=>true, getAttribute:async()=>{throw Error("The indexed link was replaced by background sync");} }),
        evaluateAll: async read => { snapshots++;return read([{getAttribute:()=>"https://external.example/"},{getAttribute:()=>href}]); },
      };
      if (selector === ".loot-opening") return {count:async()=>0};
      assert.match(selector, /:visible$/);
      assert.ok(selector.includes(JSON.stringify(href)) || selector.includes("external.example"));
      return {first:()=>({isVisible:async()=>true,click:async()=>{clicked++;current=new URL(href,current).href;}})};
    },
    waitForURL: async matches => assert.equal(matches(new URL(current)),true),
    goto: async () => {throw Error("A visible router link must preserve the running document");},
  };
  await navigateApplication(page,new URL(href,current).href);
  assert.equal(snapshots,1);assert.equal(clicked,1);
});

test("navigation discovery ignores in-page anchors such as the skip link", async () => {
  let current = "http://127.0.0.1:8080/market", clicked = [];
  const page = {
    url: () => current,
    locator(selector) {
      if (selector === "a[href]") return { evaluateAll: async (read) => read([{ getAttribute: () => "#main" }, { getAttribute: () => "/market?book=" }]) };
      if (selector === ".loot-opening") return { count: async () => 0 };
      return { first: () => ({ isVisible: async () => true, click: async () => { clicked.push(selector); current = "http://127.0.0.1:8080/market?book="; } }) };
    },
    waitForURL: async (matches) => assert.equal(matches(new URL(current)), true),
    goto: async () => { throw Error("A visible router link must preserve the running document"); },
  };
  await navigateApplication(page, "http://127.0.0.1:8080/market");
  assert.deepEqual(clicked, [`a[href=${JSON.stringify("/market?book=")}]:visible`]);
});
