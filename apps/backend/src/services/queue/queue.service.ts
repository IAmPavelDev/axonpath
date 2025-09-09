// rabbitmq.ts
import amqp, { Channel, ChannelModel } from 'amqplib';

class RabbitMQService {
  private connection: ChannelModel | null = null; // changed
  private channel: Channel | null = null;
  private readonly rabbitmqUrl: string;

  constructor(url: string) {
    this.rabbitmqUrl = url;
  }

  public async connect(): Promise<void> {
    if (this.connection && this.channel) return;

    this.connection = await amqp.connect(this.rabbitmqUrl); // now ChannelModel
    this.channel = await this.connection.createChannel();

    // ChannelModel is an EventEmitter; these events still work
    this.connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err.message);
    });
    this.connection.on('close', () => {
      console.warn('RabbitMQ connection closed.');
    });
  }

  public getChannel(): Channel {
    if (!this.channel) throw new Error('Channel is not available. Please connect first.');
    return this.channel;
  }

  public async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }
}

const rabbitMQService = new RabbitMQService('amqp://user:password@localhost');
export default rabbitMQService;