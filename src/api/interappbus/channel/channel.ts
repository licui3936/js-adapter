import { Identity } from '../../../identity';
import Transport from '../../../transport/transport';

const idOrResult = (func: (...args: any[]) => any) => (...args: any[] ) => {
    const res = func(...args);
    return res === undefined ? args[1] : res;
};

//tslint:disable-next-line
export interface ProviderIdentity extends Identity {
    channelId: string;
    isExternal?: boolean;
    channelName: string;
}

export type Action = (() => any)
    | ((payload: any) => any)
    | ((payload: any, id: ProviderIdentity) => any);
export type Middleware = (() => any)
    | ((action: string) => any)
    | ((action: string, payload: any) => any)
    | ((action: string, payload: any, id: ProviderIdentity) => any);

export interface ChannelMessagePayload extends Identity {
    action: string;
    payload: any;
}

export class ChannelBase {
    protected removeChannel: (mapKey: string) => void;
    protected subscriptions: any;
    public defaultAction: (action?: string, payload?: any, senderIdentity?: ProviderIdentity) => any;
    private preAction: (...args: any[]) => any;
    private postAction: (...args: any[]) => any;
    private errorMiddleware: (...args: any[]) => any;
    private defaultSet: boolean;

    constructor (providerIdentity: ProviderIdentity, send: Transport['sendAction'], superMap: WeakMap<ChannelBase, any>) {
        this.defaultSet = false;
        this.subscriptions = new Map<string, () => any>();
        this.defaultAction = () => {
            throw new Error('No action registered');
        };

        // The below two functions are only used by subclass, but not exposed to public. So a malicious site will not be able to use them.
        const protecteds: any = {};
        protecteds.providerIdentity = providerIdentity;
        protecteds.sendRaw = send;
        protecteds.send = async (to: Identity, action: string, payload: any) => {
            const raw = await send('send-channel-message', { ...to, providerIdentity: protecteds.providerIdentity, action, payload })
            .catch(reason => {
                throw new Error(reason.message);
            });
            return raw.payload.data.result;
        };
        superMap.set(this, protecteds);
    }

    public async processAction(action: string, payload: any, senderIdentity: ProviderIdentity) {
        try {
            const mainAction = this.subscriptions.has(action)
                ? this.subscriptions.get(action)
                : (payload: any, id: ProviderIdentity) => this.defaultAction(action, payload, id);
            const preActionProcessed = this.preAction ? await this.preAction(action, payload, senderIdentity) : payload;
            const actionProcessed = await mainAction(preActionProcessed, senderIdentity);
            return this.postAction
                ? await this.postAction(action, actionProcessed, senderIdentity)
                : actionProcessed;
        } catch (e) {
            if (this.errorMiddleware) {
                return this.errorMiddleware(action, e, senderIdentity);
            }
            throw e;
        }
    }

    public beforeAction(func: Action) {
        if (this.preAction) {
            throw new Error('Already registered beforeAction middleware');
        }
        this.preAction = idOrResult(func);
    }

    public onError(func: (action: string, error: any, id: Identity) => any) {
        if (this.errorMiddleware) {
            throw new Error('Already registered error middleware');
        }
        this.errorMiddleware = func;
    }

    public afterAction(func: Action) {
        if (this.postAction) {
            throw new Error('Already registered afterAction middleware');
        }
        this.postAction = idOrResult(func);
    }

    public remove(action: string): void {
        this.subscriptions.delete(action);
    }

    public setDefaultAction(func: (action?: string, payload?: any, senderIdentity?: ProviderIdentity) => any): void {
        if (this.defaultSet) {
            throw new Error('default action can only be set once');
        } else {
            this.defaultAction = func;
            this.defaultSet = true;
        }
    }

    public register(topic: string, listener: Action) {
        if (this.subscriptions.has(topic)) {
            throw new Error(`Subscription already registered for action: ${topic}. Unsubscribe before adding new subscription`);
        } else {
            this.subscriptions.set(topic, listener);
            return true;
        }
    }
}
