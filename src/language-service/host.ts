import path from 'node:path';
import { LanguageServiceHost } from '@volar/language-core';
import type * as ts from 'typescript/lib/tsserverlibrary';
import { AssetPluginOptions, SuggestionRule } from '../option';
import { unreachable } from '../util';

export type AssetLanguageServiceHost = LanguageServiceHost & {
  getAssetFileNames(): string[];
  isAssetFile(filePath: string): boolean;
  getMatchedSuggestionRule(assetFilePath: string): SuggestionRule | undefined;
};

export function createAssetLanguageServiceHost(
  sys: ts.System,
  info: ts.server.PluginCreateInfo,
  assetPluginOptions: AssetPluginOptions,
): AssetLanguageServiceHost {
  if (sys.watchDirectory === undefined) throw new Error('sys.watchDirectory is undefined');

  const projectRoot = path.dirname(assetPluginOptions.tsConfigPath);

  function isMatchFile(
    fileName: string,
    extensions: string[],
    exclude: string[] | undefined,
    include: string[],
  ): boolean {
    if (!extensions.includes(path.extname(fileName))) return false;
    return sys
      .readDirectory(
        path.dirname(fileName),
        undefined,
        exclude?.map((e) => path.resolve(projectRoot, e)),
        include.map((i) => path.resolve(projectRoot, i)),
        1,
      )
      .includes(fileName);
  }
  function getAssetFileNameAndRule(): Map<string, SuggestionRule> {
    const assetFileNameAndRule = new Map<string, SuggestionRule>();
    const allExtensions = assetPluginOptions.rules.map((r) => r.extensions).flat();
    const fileNames = sys.readDirectory(
      path.dirname(assetPluginOptions.tsConfigPath),
      allExtensions,
      assetPluginOptions.exclude?.map((e) => path.resolve(projectRoot, e)),
      assetPluginOptions.include.map((i) => path.resolve(projectRoot, i)),
    );
    for (const fileName of fileNames) {
      const rule = assetPluginOptions.rules.find((rule) =>
        rule.extensions.some((extension) => fileName.endsWith(extension)),
      );
      if (!rule) return unreachable(`rule not found for ${fileName}`);
      assetFileNameAndRule.set(fileName, rule);
    }
    return assetFileNameAndRule;
  }

  const assetFileNameAndRule = getAssetFileNameAndRule();
  sys.watchDirectory(
    projectRoot,
    (fileName) => {
      for (const rule of assetPluginOptions.rules) {
        if (!isMatchFile(fileName, rule.extensions, assetPluginOptions.exclude, assetPluginOptions.include)) continue;
        if (sys.fileExists(fileName)) {
          assetFileNameAndRule.set(fileName, rule);
        } else {
          assetFileNameAndRule.delete(fileName);
        }
      }
      info.project.projectService.logger.info(
        `@watchDirectory-callback: ${JSON.stringify(
          { fileName, assetFileNameAndRule: Object.fromEntries(assetFileNameAndRule) },
          null,
          2,
        )}`,
      );
      info.project.markAsDirty();
      info.project.updateGraph();
    },
    true,
    { excludeDirectories: assetPluginOptions.exclude ?? [] },
  );

  return {
    getNewLine: () => info.project.getNewLine(),
    useCaseSensitiveFileNames: () => info.project.useCaseSensitiveFileNames(),
    readFile: (path) => info.project.readFile(path),
    writeFile: (path, content) => info.project.writeFile(path, content),
    fileExists: (path) => info.project.fileExists(path),
    directoryExists: (path) => info.project.directoryExists(path),
    getDirectories: (path) => info.project.getDirectories(path),
    readDirectory: (path, extensions, exclude, include, depth) =>
      info.project.readDirectory(path, extensions, exclude, include, depth),
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    realpath: info.project.realpath ? (path) => info.project.realpath!(path) : undefined,
    getCompilationSettings: () => info.project.getCompilationSettings(),
    getCurrentDirectory: () => info.project.getCurrentDirectory(),
    getDefaultLibFileName: () => info.project.getDefaultLibFileName(),
    getProjectVersion: () => info.project.getProjectVersion(),
    getProjectReferences: () => info.project.getProjectReferences(),
    getScriptFileNames: () => {
      info.project.projectService.logger.info(`@getScriptFileNames`);
      return [...info.project.getScriptFileNames(), ...assetFileNameAndRule.keys()];
    },
    getScriptVersion: (fileName) => info.project.getScriptVersion(fileName),
    getScriptSnapshot: (fileName) => info.project.getScriptSnapshot(fileName),
    getAssetFileNames() {
      return [...assetFileNameAndRule.keys()];
    },
    isAssetFile(filePath: string) {
      return assetFileNameAndRule.has(filePath);
    },
    getMatchedSuggestionRule(assetFilePath: string) {
      return assetFileNameAndRule.get(assetFilePath);
    },
  };
}