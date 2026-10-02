/** Add every new third-party content/data resource here when integrating it. */
export const resources = [
  {
    name: "D&D 2014 encounter difficulty",
    description:
      "Encounter estimates use the 2014 Basic Rules XP thresholds and party-size multipliers. The generator is an editable estimate; terrain, tactics and house rules require DM judgment.",
    links: [
      {
        label: "Building Combat Encounters (2014)",
        url: "https://www.dndbeyond.com/sources/dnd/basic-rules-2014/building-combat-encounters",
      },
    ],
  },
  {
    name: "Open5e",
    description:
      "Lootsplit uses Open5e to retrieve SRD equipment, spells, SRD creatures for encounter generation, and other supported reference entries. Imported entries keep their individual source credits.",
    links: [
      { label: "Visit Open5e", url: "https://open5e.com" },
      { label: "Open5e licensing", url: "https://open5e.com/legal" },
    ],
  },
  ...["5.1", "5.2"].map((version) => ({
    name: `System Reference Document ${version}`,
    description: `This work includes material from the System Reference Document ${version} (“SRD ${version}”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD ${version} is licensed under the Creative Commons Attribution 4.0 International License. Retrieved through Open5e; formatting adapted. Prices and categories may be customized in Lootsplit.`,
    links: [
      { label: "Original SRD", url: "https://www.dndbeyond.com/srd" },
      { label: "CC BY 4.0 license", url: "https://creativecommons.org/licenses/by/4.0/legalcode" },
    ],
  })),
  {
    name: "Typography",
    description:
      "Cormorant Garamond, Source Sans 3, and Source Serif 4 are distributed with Lootsplit under the SIL Open Font License 1.1.",
    links: [
      { label: "Cormorant Garamond license", url: "/fonts/cormorant-garamond-LICENSE.txt" },
      { label: "Source Sans 3 license", url: "/fonts/source-sans-3-LICENSE.txt" },
      { label: "Source Serif 4 license", url: "/fonts/source-serif-4-LICENSE.txt" },
    ],
  },
];
