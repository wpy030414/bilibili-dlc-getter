import { useState, useRef, useCallback } from 'react';
import type { FetchState, ParsedUrl } from '../types';
import { parseUrl } from '../lib/parseUrl';
import { fetchDlcData } from '../lib/fetchDlcData';
import { fetchGarbSuit } from '../lib/fetchGarbSuit';

/** 按解析结果分派到对应的抓取器 */
function fetchSections(params: ParsedUrl) {
  return params.kind === 'dlc'
    ? fetchDlcData(params.id, params.lottery_id)
    : fetchGarbSuit(params.itemId);
}

const EMPTY_MESSAGES: Record<ParsedUrl['kind'], string> = {
  dlc: '未找到任何图片数据，可能该活动暂无数字周边喵～',
  garb: '未找到任何图片数据，可能该装扮已下架或暂无个性装扮喵～',
};

export function useDlcData() {
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  const lastParams = useRef<ParsedUrl | null>(null);

  const run = useCallback(async (params: ParsedUrl) => {
    setState({ status: 'loading' });
    try {
      const sections = await fetchSections(params);
      if (sections.length === 0) {
        setState({ status: 'error', message: EMPTY_MESSAGES[params.kind] });
      } else {
        setState({ status: 'success', sections });
      }
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : '网络请求失败，请稍后重试喵～',
      });
    }
  }, []);

  const submit = useCallback(
    (url: string) => {
      const params = parseUrl(url);
      if (!params) {
        setState({
          status: 'error',
          message: '无法从链接中提取 id / lottery_id，请检查链接格式是否正确喵～',
        });
        return;
      }
      lastParams.current = params;
      void run(params);
    },
    [run],
  );

  const retry = useCallback(() => {
    if (lastParams.current) void run(lastParams.current);
  }, [run]);

  return { state, submit, retry };
}
