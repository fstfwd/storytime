import {Socket, Channel} from 'phoenix';
import {record} from 'rrweb';
import * as request from 'superagent';
import {eventWithTime} from 'rrweb/typings/types';
import {win} from './utils/helpers';

const DEFAULT_HOST = 'https://app.papercups.io';
const REPLAY_EVENT_EMITTED = 'replay:event:emitted';

// TODO: figure out a better way to prevent recording on certain pages
// const blocklist: Array<string> = ['/player', '/sessions'];
const BLOCKLIST: Array<string> = [];

export const getWebsocketUrl = (baseUrl = DEFAULT_HOST) => {
  // TODO: handle this parsing better
  const [protocol, host] = baseUrl.split('://');
  const isHttps = protocol === 'https';

  // TODO: not sure how websockets work with subdomains
  return `${isHttps ? 'wss' : 'ws'}://${host}/socket`;
};

type Config = {
  accountId: string;
  customerId?: string;
  blocklist?: Array<string>;
  host?: string;
  // Currently unused
  publicKey?: string;
};

class Storytime {
  accountId: string;
  customerId?: string;
  publicKey?: string;
  blocklist: Array<string>;
  host: string;
  version: string;

  socket: Socket;
  channel!: Channel;
  sessionId?: string;

  constructor(config: Config) {
    this.accountId = config.accountId;
    this.customerId = config.customerId;
    this.publicKey = config.publicKey;
    this.blocklist = config.blocklist || BLOCKLIST;
    this.host = config.host || DEFAULT_HOST;
    this.version = '1.0.1-beta.7';

    this.socket = new Socket(getWebsocketUrl(this.host));
  }

  static init(config: Config) {
    return new Storytime(config).listen();
  }

  async listen() {
    if (!this.socket.isConnected()) {
      this.socket.connect();
    }

    this.socket.onError((err: any) => {
      // TODO: attempt to reconnect?
      console.error(err);
    });

    const sessionId = await this.getSessionId();
    const channel = this.getChannelName(sessionId);

    this.sessionId = sessionId;
    this.channel = this.socket.channel(channel, {
      customerId: this.customerId,
    });

    this.channel
      .join()
      .receive('ok', () => this.onConnectionSuccess(sessionId))
      .receive('error', (err) => this.onConnectionError(err));

    return this;
  }

  async finish() {
    if (this.sessionId) {
      const result = await this.finishBrowserSession(this.sessionId);
      console.log('Stopped recording!', this);

      return result;
    }

    return null;
  }

  createBrowserSession = async (accountId: string) => {
    // TODO: don't use superagent!
    return request
      .post(`${this.host}/api/browser_sessions`)
      .send({
        browser_session: {
          account_id: accountId,
          started_at: new Date(),
        },
      })
      .then((res) => res.body.data);
  };

  finishBrowserSession = async (sessionId: string) => {
    // TODO: don't use superagent here!
    return request
      .post(`${this.host}/api/browser_sessions/${sessionId}/finish`)
      .then((res) => res.body.data);
  };

  captureReplayEvent(event: eventWithTime) {
    // TODO: allow capturing event through other means?
    this.channel.push(REPLAY_EVENT_EMITTED, {
      event,
      customer_id: this.customerId,
    });
  }

  onConnectionSuccess(sessionId: string) {
    console.log('Start recording!', this);

    record({
      emit: (event) => {
        const pathName = win.location.pathname;

        // TODO: just emit everything until bug is fixed?
        if (this.shouldEmitEvent(pathName)) {
          this.captureReplayEvent(event);
        }
      },
    });

    win.addEventListener('beforeunload', () => {
      // TODO: verify that this actually works
      // TODO: also add ability to trigger this manually (i.e. stop a recording)
      this.finishBrowserSession(sessionId);
    });
  }

  onConnectionError(err: any) {
    // TODO: how should we handle errors?
    console.error(err);
  }

  shouldEmitEvent(pathName: string) {
    return this.blocklist.every((p) => pathName.indexOf(p) === -1);
  }

  async getSessionId(): Promise<string> {
    // TODO: check cache first?

    const {id: sessionId} = await this.createBrowserSession(this.accountId);

    return sessionId;
  }

  getChannelName(sessionId: string) {
    return `events:${this.accountId}:${sessionId}`;
  }
}

export default Storytime;
