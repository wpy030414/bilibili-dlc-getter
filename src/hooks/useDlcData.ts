import { useState, useRef, useCallback, useEffect } from 'react';
import type { FetchState, ParsedUrl } from '../types';
import { parseUrl, paramsToPath, paramsFromPathname } from '../lib/parseUrl';
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
      const { title, sections } = await fetchSections(params);
      if (sections.length === 0) {
        setState({ status: 'error', message: EMPTY_MESSAGES[params.kind] });
      } else {
        setState({ status: 'success', title, sections });
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
      // 标准化 RESTful 路径写入地址栏（不触发页面刷新）
      history.pushState(null, '', paramsToPath(params));
      void run(params);
    },
    [run],
  );

  const retry = useCallback(() => {
    if (lastParams.current) void run(lastParams.current);
  }, [run]);

  // 页面入口：首次从地址栏回读标准化参数（若存在且尚未提交，则自动发起）
  useEffect(() => {
    const params = paramsFromPathname();
    if (params) {
      lastParams.current = params;
      void run(params);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  // 浏览器前进/后退：响应地址栏变化，重新触发解析或重置为空闲态
  useEffect(() => {
    const handlePopState = () => {
      const params = paramsFromPathname();
      if (params) {
        lastParams.current = params;
        void run(params);
      } else {
        lastParams.current = null;
        setState({ status: 'idle' });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [run]);

  return { state, submit, retry };
}