import { useState, useRef, useCallback } from 'react';
import type { FetchState } from '../types';
import { parseUrl } from '../lib/parseUrl';
import { fetchDlcData } from '../lib/fetchDlcData';

export function useDlcData() {
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  const lastParams = useRef<{ id: string; lottery_id: string } | null>(null);

  const submit = useCallback(async (url: string) => {
    const params = parseUrl(url);
    if (!params) {
      setState({ status: 'error', message: '无法从链接中提取 id / lottery_id，请检查链接格式是否正确喵～' });
      return;
    }

    lastParams.current = params;
    setState({ status: 'loading' });

    try {
      const images = await fetchDlcData(params.id, params.lottery_id);
      if (images.length === 0) {
        setState({ status: 'error', message: '未找到任何图片数据，可能该活动暂无数字周边喵～' });
      } else {
        setState({ status: 'success', images });
      }
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : '网络请求失败，请稍后重试喵～',
      });
    }
  }, []);

  const retry = useCallback(() => {
    if (lastParams.current) {
      setState({ status: 'loading' });
      fetchDlcData(lastParams.current.id, lastParams.current.lottery_id)
        .then((images) => {
          if (images.length === 0) {
            setState({ status: 'error', message: '未找到任何图片数据，可能该活动暂无数字周边喵～' });
          } else {
            setState({ status: 'success', images });
          }
        })
        .catch((err) => {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : '网络请求失败，请稍后重试喵～',
          });
        });
    }
  }, []);

  return { state, submit, retry };
}